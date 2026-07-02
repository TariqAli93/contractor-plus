import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';
import type { VoiceLlmStore } from './nlu/llm/voice-llm.store.js';
import { testVoiceConnectionSchema, updateVoiceSettingsSchema } from './voice.schemas.js';

// HTTP layer for the in-app "Settings → AI → Voice Assistant" panel. The API key
// is never returned (GET sends only `apiKeySet`); update encrypts it; test only
// reports ok/error. Audit of the change is written by the store (masked).
export class VoiceSettingsController {
  constructor(private readonly store: VoiceLlmStore) {}

  get = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.store.view());
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateVoiceSettingsSchema.parse(request.body);
    const view = await this.store.update(body, this.actor(request));
    return reply.code(200).send(view);
  };

  test = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = testVoiceConnectionSchema.parse(request.body ?? {});
    return reply.code(200).send(await this.store.testConnection(body));
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
