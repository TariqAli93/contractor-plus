import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TemplatesService } from './templates.service.js';
import {
  createTemplateItemSchema,
  createTemplateSchema,
  createTemplateStepSchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,
  templateItemParamSchema,
  templateStepParamSchema,
  updateTemplateItemSchema,
  updateTemplateSchema,
  updateTemplateStepSchema,
} from './templates.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  // ----- Templates -----

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listTemplatesQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    const template = await this.service.getById(id);
    return reply.code(200).send(template);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTemplateSchema.parse(request.body);
    const created = await this.service.create(body, this.actor(request));
    return reply.code(201).send(created);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    const body = updateTemplateSchema.parse(request.body);
    const updated = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(updated);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Items -----

  addItem = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    const body = createTemplateItemSchema.parse(request.body);
    const item = await this.service.addItem(id, body, this.actor(request));
    return reply.code(201).send(item);
  };

  updateItem = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, itemId } = templateItemParamSchema.parse(request.params);
    const body = updateTemplateItemSchema.parse(request.body);
    const item = await this.service.updateItem(id, itemId, body, this.actor(request));
    return reply.code(200).send(item);
  };

  removeItem = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, itemId } = templateItemParamSchema.parse(request.params);
    await this.service.removeItem(id, itemId, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Steps -----

  addStep = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    const body = createTemplateStepSchema.parse(request.body);
    const step = await this.service.addStep(id, body, this.actor(request));
    return reply.code(201).send(step);
  };

  updateStep = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, stepId } = templateStepParamSchema.parse(request.params);
    const body = updateTemplateStepSchema.parse(request.body);
    const step = await this.service.updateStep(id, stepId, body, this.actor(request));
    return reply.code(200).send(step);
  };

  removeStep = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, stepId } = templateStepParamSchema.parse(request.params);
    await this.service.removeStep(id, stepId, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Estimate -----

  getEstimate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = templateIdParamSchema.parse(request.params);
    const estimate = await this.service.getEstimate(id);
    return reply.code(200).send(estimate);
  };

  // ----- Helpers -----

  private actor(request: FastifyRequest): AuditActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}
