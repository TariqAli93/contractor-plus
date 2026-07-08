import type { FastifyReply, FastifyRequest } from 'fastify';
import { PlatformOrchestrator } from './ai-platform.service.js';
import { messageBodySchema, openSessionBodySchema, sessionParamSchema } from './ai-platform.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { Principal } from './ai-platform.types.js';

export class AiPlatformController {
  constructor(private readonly service: PlatformOrchestrator) {}

  openSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const { title } = openSessionBodySchema.parse(request.body ?? {});
    return reply.code(201).send(await this.service.openSession(this.principal(request), title));
  };

  listSessions = async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.listSessions(this.principal(request)));
  };

  getSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = sessionParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getSession(id, this.principal(request)));
  };

  message = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = sessionParamSchema.parse(request.params);
    const { text } = messageBodySchema.parse(request.body);
    return reply.code(200).send(await this.service.message(id, text, this.principal(request)));
  };

  confirm = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = sessionParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.confirm(id, this.principal(request)));
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = sessionParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.cancel(id, this.principal(request)));
  };

  listTools = async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.listTools(this.principal(request)));
  };

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
