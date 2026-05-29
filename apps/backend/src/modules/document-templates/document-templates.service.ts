import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { MultipartFile } from '@fastify/multipart';
import {
  type DocumentTemplate,
  type GeneratedDocument,
  type PrismaClient,
  DocumentCategory,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { getStorage } from '../../lib/storage/storage.service.js';
import {
  buildPlaceholderMap,
  type PlaceholderInputs,
} from '../../lib/docx/placeholder-map.js';
import {
  DocxRenderError,
  extractPlaceholders,
  renderDocxTemplate,
} from '../../lib/docx/renderer.js';
import { DOCX_EXT, DOCX_MIME, type CreateDocumentTemplateBody } from './document-templates.schemas.js';
import { DocumentTemplatesRepository } from './document-templates.repository.js';
import type {
  DocumentTemplateView,
  GeneratedDocumentView,
} from './document-templates.types.js';

const ENTITY_TEMPLATE = 'DocumentTemplate';
const ENTITY_GENERATED = 'GeneratedDocument';
const MAX_BYTES = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

export class DocumentTemplatesService {
  private readonly repo: DocumentTemplatesRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new DocumentTemplatesRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ============================================================
  // Templates
  // ============================================================

  async listTemplates(args: {
    category?: DocumentCategory;
    includeInactive?: boolean;
  }): Promise<DocumentTemplateView[]> {
    const rows = await this.repo.list(args);
    return rows.map((r) => this.toTemplateView(r));
  }

  async getTemplate(id: string): Promise<DocumentTemplateView> {
    const t = await this.requireTemplate(id);
    return this.toTemplateView(t);
  }

  async createTemplate(
    body: CreateDocumentTemplateBody,
    file: MultipartFile,
    actor: AuditActor,
  ): Promise<DocumentTemplateView> {
    const buffer = await this.readAndValidate(file);

    // Phase 3.1 stability: placeholder extraction is intentionally disabled
    // on the upload path. PizZip throws on a surprising number of "valid"
    // DOCX shapes (zip64, sparse XML parts, non-stream encodings) and a
    // raw throw here used to crash the upload request mid-stream. The
    // renderer still parses placeholders fresh on every contract render;
    // the UI shows "0 placeholders" until that lands as a separate
    // analyze step.
    let placeholders: string[] = [];
    try {
      placeholders = extractPlaceholders(buffer);
    } catch (err) {
      // Best-effort only — never block the upload over a failed scan.
      // eslint-disable-next-line no-console
      console.warn(
        `[document-templates] placeholder extraction skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      placeholders = [];
    }

    return this.prisma.$transaction(async (tx) => {
      const dup = await this.repo.findBySlug(body.slug, tx);
      if (dup) {
        throw new ConflictError(
          `Template slug "${body.slug}" already exists`,
          'TEMPLATE_SLUG_DUPLICATE',
        );
      }

      const storage = getStorage();
      const saved = await storage.save({
        bucket: 'private/templates',
        contents: buffer,
        mimeType: DOCX_MIME,
        extension: DOCX_EXT,
      });

      const created = await this.repo.create(
        {
          name: body.name,
          slug: body.slug,
          category: body.category,
          description: body.description ?? null,
          filePath: saved.relativePath,
          mimeType: DOCX_MIME,
          isActive: body.isActive,
          placeholdersJson: placeholders,
          ...(actor.userId ? { createdByUser: { connect: { id: actor.userId } } } : {}),
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'CREATE',
          entity: ENTITY_TEMPLATE,
          entityId: created.id,
          newValues: toJsonValue({
            name: created.name,
            slug: created.slug,
            category: created.category,
            placeholders,
            size: buffer.length,
          }),
        },
        tx,
      );

      return this.toTemplateView({ ...created, placeholdersJson: placeholders });
    });
  }

  async updateTemplate(
    id: string,
    body: { name?: string; description?: string | null; isActive?: boolean },
    actor: AuditActor,
  ): Promise<DocumentTemplateView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.repo.findById(id, tx);
      if (!before) throw new NotFoundError(ENTITY_TEMPLATE, 'TEMPLATE_NOT_FOUND');

      // Deactivating the current default is allowed but clears the default
      // flag so we never persist `(default=true, active=false)`.
      const clearDefault = before.isDefault && body.isActive === false;

      const updated = await this.repo.update(
        id,
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(clearDefault ? { isDefault: false } : {}),
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY_TEMPLATE,
          entityId: id,
          oldValues: toJsonValue({
            name: before.name,
            isActive: before.isActive,
            isDefault: before.isDefault,
          }),
          newValues: toJsonValue({
            name: updated.name,
            isActive: updated.isActive,
            isDefault: updated.isDefault,
          }),
        },
        tx,
      );

      return this.toTemplateView(updated);
    });
  }

  async deleteTemplate(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.repo.findById(id, tx);
      if (!before) throw new NotFoundError(ENTITY_TEMPLATE, 'TEMPLATE_NOT_FOUND');
      if (before.isDefault) {
        throw new ConflictError(
          'Cannot delete the default template — set another default first',
          'TEMPLATE_IS_DEFAULT',
        );
      }
      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ENTITY_TEMPLATE,
          entityId: id,
          oldValues: toJsonValue({ name: before.name, slug: before.slug, category: before.category }),
        },
        tx,
      );
    });
  }

  async setDefault(id: string, actor: AuditActor): Promise<DocumentTemplateView> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.repo.findById(id, tx);
      if (!target) throw new NotFoundError(ENTITY_TEMPLATE, 'TEMPLATE_NOT_FOUND');
      if (!target.isActive) {
        throw new ConflictError(
          'Cannot set an inactive template as default',
          'TEMPLATE_INACTIVE',
        );
      }
      if (target.isDefault) return this.toTemplateView(target); // idempotent

      // Two-step swap inside the transaction so the "at most one default
      // per category" invariant holds even with a future partial unique
      // index. Matches the currency default pattern.
      await this.repo.clearDefaultsForCategory(target.category, tx);
      const updated = await this.repo.update(id, { isDefault: true }, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY_TEMPLATE,
          entityId: id,
          oldValues: toJsonValue({ isDefault: false }),
          newValues: toJsonValue({ isDefault: true, category: target.category }),
        },
        tx,
      );

      return this.toTemplateView(updated);
    });
  }

  /**
   * Resolve a template ID to an absolute filesystem path the static
   * download handler can stream. Includes the row so the caller can fill
   * in the right filename/content-type headers.
   */
  async getTemplateForDownload(id: string): Promise<{
    template: DocumentTemplate;
    absolutePath: string;
  }> {
    const template = await this.requireTemplate(id);
    const absolutePath = getStorage().resolveAbsolutePath(template.filePath);
    return { template, absolutePath };
  }

  // ============================================================
  // Generation
  // ============================================================

  async generateContractDocx(
    contractId: string,
    templateId: string | undefined,
    actor: AuditActor,
  ): Promise<GeneratedDocumentView> {
    // Pull all the data we need OUTSIDE the transaction — the renderer
    // touches the filesystem and we don't want to hold a long-running DB
    // transaction across that. The persistence step is its own short tx.
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: { customer: true, project: true },
    });
    if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');

    const template = templateId
      ? await this.requireTemplate(templateId)
      : await this.requireDefaultTemplate(DocumentCategory.CONTRACT);

    if (template.category !== DocumentCategory.CONTRACT) {
      throw new ConflictError(
        'Selected template is not a contract template',
        'TEMPLATE_CATEGORY_MISMATCH',
      );
    }

    const [companyProfile, defaultCurrency] = await Promise.all([
      this.prisma.companyProfile.findUnique({ where: { id: 'default' } }),
      this.prisma.currency.findFirst({ where: { isDefault: true } }),
    ]);

    const inputs: PlaceholderInputs = {
      company: companyProfile,
      customer: contract.customer,
      project: contract.project
        ? { ...contract.project, location: contract.customer?.address ?? null }
        : null,
      contract: contract,
      currency: defaultCurrency,
    };
    const placeholders = buildPlaceholderMap(inputs);

    const storage = getStorage();
    const templateAbsPath = storage.resolveAbsolutePath(template.filePath);

    let rendered: Buffer;
    try {
      const result = await renderDocxTemplate(templateAbsPath, placeholders);
      rendered = result.buffer;
    } catch (err) {
      if (err instanceof DocxRenderError) {
        throw new ConflictError(
          `${err.message}${err.explanation ? ` — ${err.explanation}` : ''}`,
          err.code,
        );
      }
      throw err;
    }

    // Save under private/contracts so static serving never touches it.
    const saved = await storage.save({
      bucket: 'private/contracts',
      contents: rendered,
      mimeType: DOCX_MIME,
      extension: DOCX_EXT,
    });

    const downloadFilename = buildContractFilename(contract.contractNumber);

    const row = await this.prisma.$transaction(async (tx) => {
      const generated = await this.repo.createGenerated(
        {
          template: { connect: { id: template.id } },
          contract: { connect: { id: contract.id } },
          ...(contract.project ? { project: { connect: { id: contract.project.id } } } : {}),
          customer: { connect: { id: contract.customerId } },
          filename: downloadFilename,
          filePath: saved.relativePath,
          mimeType: DOCX_MIME,
          size: rendered.length,
          ...(actor.userId
            ? { generatedByUser: { connect: { id: actor.userId } } }
            : {}),
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'CREATE',
          entity: ENTITY_GENERATED,
          entityId: generated.id,
          newValues: toJsonValue({
            templateId: template.id,
            contractId: contract.id,
            filename: downloadFilename,
            size: rendered.length,
          }),
        },
        tx,
      );

      return generated;
    });

    return this.toGeneratedView({ ...row, template: { name: template.name } });
  }

  async listGenerated(args: {
    contractId?: string;
    projectId?: string;
    customerId?: string;
  }): Promise<GeneratedDocumentView[]> {
    const rows = await this.repo.listGenerated(args);
    return rows.map((r) => this.toGeneratedView(r));
  }

  async getGeneratedForDownload(id: string): Promise<{
    row: GeneratedDocument & { template: { name: string } };
    absolutePath: string;
  }> {
    const row = await this.repo.findGenerated(id);
    if (!row) throw new NotFoundError(ENTITY_GENERATED, 'GENERATED_NOT_FOUND');
    const absolutePath = getStorage().resolveAbsolutePath(row.filePath);
    return { row, absolutePath };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async requireTemplate(id: string): Promise<DocumentTemplate> {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundError(ENTITY_TEMPLATE, 'TEMPLATE_NOT_FOUND');
    return t;
  }

  private async requireDefaultTemplate(category: DocumentCategory): Promise<DocumentTemplate> {
    const t = await this.repo.findDefaultFor(category);
    if (!t) {
      throw new ConflictError(
        `No default ${category.toLowerCase()} template configured`,
        'NO_DEFAULT_TEMPLATE',
      );
    }
    return t;
  }

  private async readAndValidate(file: MultipartFile): Promise<Buffer> {
    if (file.mimetype !== DOCX_MIME) {
      throw new ValidationError('Unsupported file type', {
        file: [`mime "${file.mimetype}" is not allowed (DOCX only)`],
      });
    }
    const ext = path.extname(file.filename).replace(/^\./, '').toLowerCase();
    if (ext !== DOCX_EXT) {
      throw new ValidationError('Unsupported file extension', {
        file: [`extension ".${ext}" is not allowed (.docx only)`],
      });
    }
    // file.toBuffer() can throw if the upstream multipart parser hit its
    // size limit, or if the client aborted mid-stream. Convert any such
    // raw error into a structured ValidationError so the connection still
    // closes cleanly with a 400 instead of bubbling up uncaught.
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isLimit = /limit|size/i.test(message);
      throw new ValidationError(
        isLimit ? 'File too large' : 'Failed to read uploaded file',
        {
          file: [isLimit ? `maximum size is ${env.MAX_UPLOAD_SIZE_MB} MB` : message],
        },
      );
    }
    if (buffer.length === 0) {
      throw new ValidationError('Uploaded file is empty', { file: ['empty file'] });
    }
    if (buffer.length > MAX_BYTES) {
      throw new ValidationError('File too large', {
        file: [`maximum size is ${env.MAX_UPLOAD_SIZE_MB} MB`],
      });
    }
    // DOCX magic: PK\x03\x04 (ZIP) — fast rejection of `.docx`-renamed
    // PDFs, RTFs, etc. before the renderer even tries to parse them.
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      throw new ValidationError('File is not a valid DOCX document', {
        file: ['invalid DOCX signature'],
      });
    }
    return buffer;
  }

  private toTemplateView(t: DocumentTemplate): DocumentTemplateView {
    const placeholders = Array.isArray(t.placeholdersJson)
      ? (t.placeholdersJson.filter((v) => typeof v === 'string') as string[])
      : [];
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      category: t.category,
      description: t.description,
      mimeType: t.mimeType,
      isActive: t.isActive,
      isDefault: t.isDefault,
      placeholders,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toGeneratedView(
    g: GeneratedDocument & { template: { name: string } },
  ): GeneratedDocumentView {
    return {
      id: g.id,
      templateId: g.templateId,
      templateName: g.template.name,
      contractId: g.contractId,
      projectId: g.projectId,
      customerId: g.customerId,
      filename: g.filename,
      mimeType: g.mimeType,
      size: g.size,
      generatedBy: g.generatedBy,
      createdAt: g.createdAt.toISOString(),
      // Frontend hits this via the authenticated API; storage absolute
      // paths are never exposed.
      downloadUrl: `/api/v1/generated-documents/${g.id}/download`,
    };
  }
}

/**
 * Generated DOCX filenames. Predictable, contains the contract number for
 * humans + a timestamp suffix so re-generating the same contract doesn't
 * clobber a previous download in the user's browser cache.
 */
function buildContractFilename(contractNumber: string): string {
  // Strip unsafe characters; keep alphanumerics, dashes, underscores.
  const safeNumber = contractNumber.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return `contract-${safeNumber || 'unnamed'}-${stamp}.docx`;
}

// Re-export `stat` so callers in the controller can compute size headers
// from the resolved path without re-importing node:fs/promises themselves.
export { stat as fileStat };
