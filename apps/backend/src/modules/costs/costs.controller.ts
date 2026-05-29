import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CostsService } from './costs.service.js';
import {
  costIdParamSchema,
  createCostSchema,
  listCostsQuerySchema,
  projectIdParamSchema,
  updateCostSchema,
} from './costs.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class CostsController {
  constructor(private readonly service: CostsService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listCostsQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = costIdParamSchema.parse(request.params);
    const cost = await this.service.getById(id);
    return reply.code(200).send(cost);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createCostSchema.parse(request.body);
    const cost = await this.service.create(body, this.actor(request));
    return reply.code(201).send(cost);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = costIdParamSchema.parse(request.params);
    const body = updateCostSchema.parse(request.body);
    const cost = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(cost);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = costIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Project-scoped views -----

  listForProject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const query = listCostsQuerySchema.parse(request.query);
    const result = await this.service.listForProject(id, query);
    return reply.code(200).send(result);
  };

  getProjectSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const summary = await this.service.getProjectSummary(id);
    return reply.code(200).send(summary);
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
