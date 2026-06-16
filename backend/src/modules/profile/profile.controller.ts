import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProfileService } from './profile.service.js';
import { changePasswordSchema, updateProfileSchema } from './profile.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  get = async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.get(this.userId(request)));
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateProfileSchema.parse(request.body);
    return reply.code(200).send(await this.service.update(this.userId(request), body, this.actor(request)));
  };

  changePassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = changePasswordSchema.parse(request.body);
    await this.service.changePassword(this.userId(request), body, this.actor(request));
    return reply.code(200).send({ success: true });
  };

  private userId(request: FastifyRequest): string {
    if (!request.user) throw new UnauthorizedError();
    return request.user.id;
  }

  private actor(request: FastifyRequest): AuditActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}
