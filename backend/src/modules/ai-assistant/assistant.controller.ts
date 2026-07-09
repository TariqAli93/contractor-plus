import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AssistantOrchestrator } from './assistant.orchestrator.js';
import type { AuditQueryService } from './audit-query.service.js';
import { messageBodySchema, openSessionBodySchema, sessionParamSchema } from '../ai-platform/ai-platform.schemas.js';
import { auditQuerySchema } from './assistant.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { Principal } from '../ai-platform/ai-platform.types.js';

export class AssistantController {
  constructor(
    private readonly service: AssistantOrchestrator,
    private readonly audit: AuditQueryService,
  ) {}

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

  auditList = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = auditQuerySchema.parse(request.query ?? {});
    return reply.code(200).send(await this.audit.list(query));
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
