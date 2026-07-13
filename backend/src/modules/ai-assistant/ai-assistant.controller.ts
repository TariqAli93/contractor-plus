import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';
import type { AiAssistantService } from './ai-assistant.service.js';
import { narrativeBodySchemas, narrativeParamsSchema } from './ai-assistant.schemas.js';
import { nlQueryBodySchema } from './ai-query.schema.js';

export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  status = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(this.service.getStatus());
  };

  reportNarrative = async (request: FastifyRequest, reply: FastifyReply) => {
    const { reportType } = narrativeParamsSchema.parse(request.params);
    // Body carries the SAME filters as the numeric report (whitelist per type).
    const query = narrativeBodySchemas[reportType].parse(request.body ?? {});
    const result = await this.service.reports.narrative(reportType, query, this.actor(request));
    return reply.code(200).send(result);
  };

  nlReportQuery = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = nlQueryBodySchema.parse(request.body ?? {});
    const result = await this.service.reports.queryFromText(
      body.text,
      body.narrate,
      this.actor(request),
    );
    return reply.code(200).send(result);
  };

  private actor(request: FastifyRequest): AuditActor {
    if (!request.user) throw new UnauthorizedError();
    return {
      userId: request.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }
}
