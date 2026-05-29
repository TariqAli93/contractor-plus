import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TunnelService } from './tunnel.service.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class TunnelController {
  constructor(private readonly service: TunnelService) {}

  status = async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.getStatus();
    return reply.code(200).send(result);
  };

  enable = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.enable(this.actor(request));
    return reply.code(200).send(result);
  };

  disable = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.disable(this.actor(request));
    return reply.code(200).send(result);
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
