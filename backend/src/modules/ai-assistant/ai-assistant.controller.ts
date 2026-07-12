import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiAssistantService } from './ai-assistant.service.js';

export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  status = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(this.service.getStatus());
  };
}
