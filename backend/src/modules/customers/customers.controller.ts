import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CustomersService } from './customers.service.js';
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customers.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listCustomersQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const customer = await this.service.getById(id);
    return reply.code(200).send(customer);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createCustomerSchema.parse(request.body);
    const customer = await this.service.create(body, this.actor(request));
    return reply.code(201).send(customer);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCustomerSchema.parse(request.body);
    const customer = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(customer);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
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
