import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';
import type { AiAssistantService } from './ai-assistant.service.js';
import {
  chatSendBodySchema,
  guardCostBodySchema,
  guardPaymentBodySchema,
  materialIdParamSchema,
  narrativeBodySchemas,
  narrativeParamsSchema,
  setApiKeyBodySchema,
  suggestionIdParamSchema,
  threadIdParamSchema,
  updateSettingsBodySchema,
} from './ai-assistant.schemas.js';
import { nlQueryBodySchema } from './ai-query.schema.js';

export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  status = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.getStatus());
  };

  settings = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.getSettings());
  };

  updateSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateSettingsBodySchema.parse(request.body ?? {});
    await this.service.settings.updateSettings(body, this.actor(request));
    return reply.code(200).send(await this.service.getSettings());
  };

  setApiKey = async (request: FastifyRequest, reply: FastifyReply) => {
    const { apiKey } = setApiKeyBodySchema.parse(request.body ?? {});
    await this.service.settings.setApiKey(apiKey, this.actor(request));
    // Respond with the (key-free) settings so the UI refreshes status.
    return reply.code(200).send(await this.service.getSettings());
  };

  clearApiKey = async (request: FastifyRequest, reply: FastifyReply) => {
    await this.service.settings.clearApiKey(this.actor(request));
    return reply.code(200).send(await this.service.getSettings());
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

  guardCost = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = guardCostBodySchema.parse(request.body ?? {});
    const result = await this.service.recommendations.guardCost(body, this.actor(request));
    return reply.code(200).send(result);
  };

  guardPayment = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = guardPaymentBodySchema.parse(request.body ?? {});
    const result = await this.service.recommendations.guardPayment(body, this.actor(request));
    return reply.code(200).send(result);
  };

  listRecommendations = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.recommendations.listRecommendations(this.actor(request));
    return reply.code(200).send(result);
  };

  applySuggestion = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = suggestionIdParamSchema.parse(request.params);
    const result = await this.service.recommendations.applySuggestion(id, this.actor(request));
    return reply.code(200).send(result);
  };

  rejectSuggestion = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = suggestionIdParamSchema.parse(request.params);
    const result = await this.service.recommendations.rejectSuggestion(id, this.actor(request));
    return reply.code(200).send(result);
  };

  syncMaterialPrices = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.materialPrices.syncPrices(this.actor(request));
    return reply.code(200).send(result);
  };

  materialReferencePrice = async (request: FastifyRequest, reply: FastifyReply) => {
    const { materialId } = materialIdParamSchema.parse(request.params);
    const result = await this.service.materialPrices.getLatestForMaterial(materialId);
    return reply.code(200).send(result);
  };

  materialPriceChanges = async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.materialPrices.getRecentPriceChanges();
    return reply.code(200).send({ items: result });
  };

  // ----- Phase 7: chat -----

  chatSend = async (request: FastifyRequest, reply: FastifyReply) => {
    const { text, threadId } = chatSendBodySchema.parse(request.body ?? {});
    const result = await this.service.chat.send(text, threadId, this.actor(request));
    return reply.code(200).send(result);
  };

  chatThreads = async (request: FastifyRequest, reply: FastifyReply) => {
    const items = await this.service.chat.listThreads(this.actor(request));
    return reply.code(200).send({ items });
  };

  chatThread = async (request: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = threadIdParamSchema.parse(request.params);
    const result = await this.service.chat.getThread(threadId, this.actor(request));
    return reply.code(200).send(result);
  };

  chatDeleteThread = async (request: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = threadIdParamSchema.parse(request.params);
    await this.service.chat.deleteThread(threadId, this.actor(request));
    return reply.code(204).send();
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
