import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UploadsService } from './uploads.service.js';
import { companyAssetKindSchema } from './uploads.schemas.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

interface KindParams {
  kind: string;
}

export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  // GET /company  — returns both assets in a single payload so the UI
  // only needs one round-trip to render the company-profile section.
  getCompanyAssets = async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await this.service.getCompanyAssets();
    return reply.code(200).send(data);
  };

  // POST /company/:kind  — multipart with a single field named "file".
  uploadCompanyAsset = async (request: FastifyRequest, reply: FastifyReply) => {
    const kind = companyAssetKindSchema.parse((request.params as KindParams).kind);
    const file = await request.file();
    if (!file) {
      throw new ValidationError('No file uploaded', { file: ['file field is required'] });
    }
    const result = await this.service.uploadCompanyAsset(kind, file, this.actor(request));
    return reply.code(200).send(result);
  };

  // DELETE /company/:kind  — clears the asset reference and removes the
  // file from disk. Idempotent: deleting a missing asset returns 204.
  deleteCompanyAsset = async (request: FastifyRequest, reply: FastifyReply) => {
    const kind = companyAssetKindSchema.parse((request.params as KindParams).kind);
    await this.service.deleteCompanyAsset(kind, this.actor(request));
    return reply.code(204).send();
  };

  private actor(request: FastifyRequest): AuditActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}
