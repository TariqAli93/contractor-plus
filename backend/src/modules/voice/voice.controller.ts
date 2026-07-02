import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { VoiceService } from './voice.service.js';
import { decisionSchema, interpretSchema } from './voice.schemas.js';
import type { VoiceActor } from './voice.types.js';

export class VoiceController {
  constructor(private readonly service: VoiceService) {}

  interpret = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = interpretSchema.parse(request.body);
    const result = await this.service.interpret(this.actor(request), body);
    return reply.code(200).send(result);
  };

  decide = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = decisionSchema.parse(request.body);
    const result = await this.service.decide(this.actor(request), body);
    return reply.code(200).send(result);
  };

  private actor(request: FastifyRequest): VoiceActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      role: request.user.role,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}
