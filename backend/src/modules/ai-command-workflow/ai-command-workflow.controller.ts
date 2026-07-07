import type { FastifyReply, FastifyRequest } from 'fastify';
import { AiCommandWorkflowService, type Principal } from './ai-command-workflow.service.js';
import type { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';
import {
  cancelBodySchema,
  confirmBodySchema,
  interpretBodySchema,
  sessionParamSchema,
  testLlmSettingsSchema,
  updateLlmSettingsSchema,
} from './ai-command-workflow.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';

export class AiCommandWorkflowController {
  constructor(
    private readonly service: AiCommandWorkflowService,
    private readonly settings: LlmSettingsStore,
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
    const view = await this.settings.update(body, this.actor(request));
    return reply.code(200).send(view);
  };

  testSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = testLlmSettingsSchema.parse(request.body);
    return reply.code(200).send(await this.settings.testConnection(body));
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
