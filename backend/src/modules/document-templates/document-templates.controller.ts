import { createReadStream } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DocumentTemplatesService } from './document-templates.service.js';
import {
  createDocumentTemplateBodySchema,
  documentTemplateIdParamSchema,
  generateContractDocxBodySchema,
  generatedDocumentIdParamSchema,
  listDocumentTemplatesQuerySchema,
  updateDocumentTemplateBodySchema,
} from './document-templates.schemas.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';
import { fileStat } from './document-templates.service.js';
import { contractIdParamSchema } from '../contracts/contracts.schemas.js';

export class DocumentTemplatesController {
  constructor(private readonly service: DocumentTemplatesService) {}

  // ---------- templates ----------

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listDocumentTemplatesQuerySchema.parse(request.query);
    const items = await this.service.listTemplates(query);
    return reply.code(200).send({ items });
  };

  // Multipart upload. The text fields ride alongside the `file` part as
  // standard multipart form fields — see document-templates.api.ts on the
  // frontend (text fields MUST precede the file in the multipart body so
  // they're available on `file.fields` here).
  //
  // The whole flow is wrapped so a failed validation always drains the
  // incoming file stream before responding. Without this, an early throw
  // would leave the multipart body mid-transfer and Fastify would reset
  // the underlying socket (ERR_CONNECTION_RESET on the client).
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await request.file();
    if (!file) {
      throw new ValidationError('No file uploaded', { file: ['file field is required'] });
    }

    try {
      const fields = readTextFields(file);
      const body = createDocumentTemplateBodySchema.parse(fields);
      const created = await this.service.createTemplate(body, file, this.actor(request));
      return reply.code(201).send(created);
    } catch (err) {
      // Ensure the inbound file stream is consumed even on failure so the
      // connection closes cleanly. .toBuffer() may have already been
      // called by the service; in that case `file.file` is no longer
      // readable and drainStream is a no-op.
      await drainStream(file.file).catch(() => undefined);
      throw err;
    }
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = documentTemplateIdParamSchema.parse(request.params);
    const body = updateDocumentTemplateBodySchema.parse(request.body);
    const updated = await this.service.updateTemplate(id, body, this.actor(request));
    return reply.code(200).send(updated);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = documentTemplateIdParamSchema.parse(request.params);
    await this.service.deleteTemplate(id, this.actor(request));
    return reply.code(204).send();
  };

  setDefault = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = documentTemplateIdParamSchema.parse(request.params);
    const updated = await this.service.setDefault(id, this.actor(request));
    return reply.code(200).send(updated);
  };

  downloadTemplate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = documentTemplateIdParamSchema.parse(request.params);
    const { template, absolutePath } = await this.service.getTemplateForDownload(id);
    const stats = await fileStat(absolutePath);
    return this.streamFile(reply, absolutePath, {
      filename: `${template.slug}.docx`,
      mimeType: template.mimeType,
      size: stats.size,
    });
  };

  // ---------- generation ----------

  generateContractDocx = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const body = generateContractDocxBodySchema.parse(request.body ?? {});
    const generated = await this.service.generateContractDocx(
      id,
      body.templateId,
      this.actor(request),
    );
    return reply.code(201).send(generated);
  };

  downloadGenerated = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = generatedDocumentIdParamSchema.parse(request.params);
    const { row, absolutePath } = await this.service.getGeneratedForDownload(id);
    return this.streamFile(reply, absolutePath, {
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
    });
  };

  listGeneratedForContract = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const items = await this.service.listGenerated({ contractId: id });
    return reply.code(200).send({ items });
  };

  // ---------- shared helpers ----------

  private streamFile(
    reply: FastifyReply,
    absolutePath: string,
    meta: { filename: string; mimeType: string; size: number },
  ) {
    // Quoted UTF-8 filename for Arabic-safe content-disposition.
    const safe = encodeURIComponent(meta.filename);
    reply
      .header('Content-Type', meta.mimeType)
      .header('Content-Length', String(meta.size))
      .header('Content-Disposition', `attachment; filename*=UTF-8''${safe}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(createReadStream(absolutePath));
  }

  private actor(request: FastifyRequest): AuditActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}

/**
 * Pull the text fields from a single-file multipart request. @fastify/multipart
 * attaches sibling fields onto the file object under `fields`. We coerce the
 * shape to a flat string map so zod's `parse` can run normally.
 */
function readTextFields(file: import('@fastify/multipart').MultipartFile): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = (file as unknown as { fields?: Record<string, unknown> }).fields ?? {};
  for (const [key, value] of Object.entries(fields)) {
    if (!value || typeof value !== 'object') continue;
    // Multipart "fields" are objects with `value` when they're text fields.
    // The file part itself has `file`; skip it here.
    if ('file' in value) continue;
    const v = (value as { value?: unknown }).value;
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

/**
 * Read-and-discard a Node Readable so the underlying multipart parser can
 * finish without backpressure. Safe to call on streams that have already
 * been consumed (`readable === false` returns immediately). Errors are
 * swallowed — this runs in cleanup paths where we only care about
 * ordering, not data integrity.
 */
async function drainStream(stream: NodeJS.ReadableStream): Promise<void> {
  if (!stream || !(stream as NodeJS.ReadableStream & { readable?: boolean }).readable) {
    return;
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', done);
    // Consume the data without buffering it.
    stream.resume();
  });
}
