import type { FastifyReply, FastifyRequest } from 'fastify';
import { EstimationTemplatesService } from './estimation-templates.service.js';
import {
  confirmDraftBodySchema,
  draftIdParamSchema,
  draftItemParamSchema,
  generateDraftBodySchema,
  listEstimationTemplatesQuerySchema,
  resolveMaterialsBodySchema,
  updateDraftItemBodySchema,
  updateEstimationTemplateSchema,
  wastePercentageBodySchema,
} from './estimation-templates.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { Principal } from './estimation-templates.types.js';

export class EstimationTemplatesController {
  constructor(private readonly service: EstimationTemplatesService) {}

  // ---------- AI draft lifecycle ----------

  generate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { command, draftId } = generateDraftBodySchema.parse(request.body);
    const result = await this.service.generateDraft(command, draftId, this.principal(request));
    return reply.code(200).send(result);
  };

  getDraft = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getDraft(draftId, this.principal(request)));
  };

  resolveMaterials = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    const { decisions } = resolveMaterialsBodySchema.parse(request.body);
    const result = await this.service.resolveMaterialDecisions(draftId, decisions, this.principal(request));
    return reply.code(200).send(result);
  };

  updateItem = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId, tempId } = draftItemParamSchema.parse(request.params);
    const patch = updateDraftItemBodySchema.parse(request.body);
    const result = await this.service.updateDraftItem(draftId, tempId, patch, this.principal(request));
    return reply.code(200).send(result);
  };

  updateWaste = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    const { wastePercentage } = wastePercentageBodySchema.parse(request.body);
    const result = await this.service.updateWastePercentage(draftId, wastePercentage, this.principal(request));
    return reply.code(200).send(result);
  };

  preview = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getPreview(draftId, this.principal(request)));
  };

  confirm = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    const { templateName } = confirmDraftBodySchema.parse(request.body);
    const result = await this.service.confirmDraft(draftId, templateName, this.principal(request));
    return reply.code(200).send(result);
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = draftIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.cancelDraft(draftId, this.principal(request)));
  };

  // ---------- confirmed templates ----------

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listEstimationTemplatesQuerySchema.parse(request.query);
    return reply.code(200).send(await this.service.listTemplates(query));
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getTemplate(id));
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateEstimationTemplateSchema.parse(request.body);
    return reply.code(200).send(await this.service.updateTemplate(id, body, this.principal(request)));
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.deleteTemplate(id, this.principal(request));
    return reply.code(204).send();
  };

  // ---------- helpers ----------

  private principal(request: FastifyRequest): Principal {
    if (!request.user) throw new UnauthorizedError();
    const user = request.user;
    return {
      userId: user.id,
      role: user.role,
      actor: { userId: user.id, ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? '' },
    };
  }
}
