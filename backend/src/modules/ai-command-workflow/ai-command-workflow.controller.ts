import type { FastifyReply, FastifyRequest } from 'fastify';
import { AiCommandWorkflowService, type Principal } from './ai-command-workflow.service.js';
import type { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';
import type { OpenRouterModelsService } from '../../lib/llm/openrouter-models.service.js';
import {
  cancelBodySchema,
  confirmBodySchema,
  interpretBodySchema,
  modelsQuerySchema,
  sessionParamSchema,
  testLlmSettingsSchema,
  updateLlmSettingsSchema,
} from './ai-command-workflow.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';

export class AiCommandWorkflowController {
  constructor(
    private readonly service: AiCommandWorkflowService,
    private readonly settings: LlmSettingsStore,
    private readonly models: OpenRouterModelsService,
  ) {}

  // ---------- command turns ----------

  interpret = async (request: FastifyRequest, reply: FastifyReply) => {
    const { text, sessionId } = interpretBodySchema.parse(request.body);
    const result = await this.service.interpret(text, sessionId, this.principal(request));
    return reply.code(200).send(result);
  };

  confirm = async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = confirmBodySchema.parse(request.body);
    const result = await this.service.confirm(sessionId, this.principal(request));
    return reply.code(200).send(result);
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = cancelBodySchema.parse(request.body);
    const result = await this.service.cancel(sessionId, this.principal(request));
    return reply.code(200).send(result);
  };

  getSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = sessionParamSchema.parse(request.params);
    const user = this.requireUser(request);
    const session = this.service.getSession(sessionId, user.id);
    if (!session) throw new NotFoundError('Session', 'SESSION_NOT_FOUND');
    return reply.code(200).send({
      sessionId: session.sessionId,
      pendingIntent: session.pendingIntent,
      collectedSlots: session.collectedSlots,
      missingSlots: session.missingSlots,
      hasPendingPlan: session.pendingPlan !== null,
      pendingPlan: session.pendingPlan
        ? { intent: session.pendingPlan.intent, steps: session.pendingPlan.steps, confirmationMessage: session.pendingPlan.confirmationMessage }
        : null,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  };

  getInsights = async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.getInsights(this.principal(request)));
  };

  // ---------- LLM settings ----------

  getSettings = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.settings.view());
  };

  updateSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateLlmSettingsSchema.parse(request.body);
    // Guard against saving a display name (or a typo) instead of a real
    // OpenRouter model id. Only enforced when the catalog is actually available,
    // so configuration is never blocked while OpenRouter is unreachable.
    if (body.model) {
      const cfg = await this.settings.resolve();
      const { models } = await this.models.list({}, cfg.apiKey);
      if (models.length > 0 && !models.some((m) => m.id === body.model)) {
        throw new ValidationError(
          'النموذج المحدد غير موجود ضمن نماذج OpenRouter المتاحة — اختر نموذجاً من القائمة (مثل openai/gpt-4o-mini).',
          { model: ['not_in_openrouter_catalog'] },
        );
      }
    }
    const view = await this.settings.update(body, this.actor(request));
    return reply.code(200).send(view);
  };

  testSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = testLlmSettingsSchema.parse(request.body);
    return reply.code(200).send(await this.settings.testConnection(body));
  };

  // ---------- OpenRouter model discovery ----------

  getModels = async (request: FastifyRequest, reply: FastifyReply) => {
    const filter = modelsQuerySchema.parse(request.query);
    // The stored key (if any) lifts OpenRouter's per-IP rate limit; it is used
    // server-side only and never returned to the client.
    const cfg = await this.settings.resolve();
    try {
      const result = await this.models.list(filter, cfg.apiKey);
      return reply.code(200).send(result);
    } catch {
      // No cache and OpenRouter unreachable — degrade gracefully so the UI can
      // show an "unavailable" state instead of erroring the whole settings page.
      return reply.code(200).send({ models: [], stale: true, fetchedAt: null });
    }
  };

  // ---------- helpers ----------

  private requireUser(request: FastifyRequest) {
    if (!request.user) throw new UnauthorizedError();
    return request.user;
  }

  private actor(request: FastifyRequest) {
    const user = this.requireUser(request);
    return { userId: user.id, ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? '' };
  }

  private principal(request: FastifyRequest): Principal {
    const user = this.requireUser(request);
    return {
      userId: user.id,
      role: user.role,
      actor: { userId: user.id, ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? '' },
    };
  }
}
