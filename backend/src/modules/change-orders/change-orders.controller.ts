import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ChangeOrdersService } from './change-orders.service.js';
import {
  changeOrderIdParamSchema,
  contractIdParamSchema,
  createChangeOrderSchema,
  listChangeOrdersQuerySchema,
  updateChangeOrderSchema,
} from './change-orders.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class ChangeOrdersController {
  constructor(private readonly service: ChangeOrdersService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listChangeOrdersQuerySchema.parse(request.query);
    return reply.code(200).send(await this.service.list(query));
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = changeOrderIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getById(id));
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createChangeOrderSchema.parse(request.body);
    return reply.code(201).send(await this.service.create(body, this.actor(request)));
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = changeOrderIdParamSchema.parse(request.params);
    const body = updateChangeOrderSchema.parse(request.body);
    return reply.code(200).send(await this.service.update(id, body, this.actor(request)));
  };

  approve = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = changeOrderIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.approve(id, this.actor(request)));
  };

  reject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = changeOrderIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.reject(id, this.actor(request)));
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = changeOrderIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Contract-scoped views -----

  listForContract = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const query = listChangeOrdersQuerySchema.parse(request.query);
    return reply.code(200).send(await this.service.listForContract(id, query));
  };

  summaryForContract = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.summaryForContract(id));
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
