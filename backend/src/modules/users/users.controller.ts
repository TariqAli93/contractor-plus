import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UsersService, ActingUser } from './users.service.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from './users.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';

export class UsersController {
  constructor(private readonly service: UsersService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listUsersQuerySchema.parse(request.query);
    return reply.code(200).send(await this.service.list(query));
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getById(id));
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createUserSchema.parse(request.body);
    return reply.code(201).send(await this.service.create(body, this.acting(request)));
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateUserSchema.parse(request.body);
    return reply.code(200).send(await this.service.update(id, body, this.acting(request)));
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.softDelete(id, this.acting(request));
    return reply.code(204).send();
  };

  activate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.setActive(id, true, this.acting(request)));
  };

  deactivate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.setActive(id, false, this.acting(request)));
  };

  resetPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = resetPasswordSchema.parse(request.body);
    await this.service.resetPassword(id, body, this.acting(request));
    return reply.code(200).send({ success: true });
  };

  private acting(request: FastifyRequest): ActingUser {
    if (!request.user) throw new UnauthorizedError();
    return {
      id: request.user.id,
      role: request.user.role,
      actor: {
        userId: request.user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
      },
    };
  }
}
