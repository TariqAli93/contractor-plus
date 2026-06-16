import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PaymentsService } from './payments.service.js';
import {
  cancelPaymentBodySchema,
  createPaymentSchema,
  listPaymentsQuerySchema,
  markPaidBodySchema,
  paymentIdParamSchema,
  projectIdParamSchema,
  updatePaymentSchema,
} from './payments.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listPaymentsQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = paymentIdParamSchema.parse(request.params);
    const payment = await this.service.getById(id);
    return reply.code(200).send(payment);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPaymentSchema.parse(request.body);
    const payment = await this.service.create(body, this.actor(request));
    return reply.code(201).send(payment);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = paymentIdParamSchema.parse(request.params);
    const body = updatePaymentSchema.parse(request.body);
    const payment = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(payment);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = paymentIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Actions -----

  markPaid = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = paymentIdParamSchema.parse(request.params);
    const body = markPaidBodySchema.parse(request.body);
    const payment = await this.service.markPaid(id, body, this.actor(request));
    return reply.code(200).send(payment);
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = paymentIdParamSchema.parse(request.params);
    const body = cancelPaymentBodySchema.parse(request.body ?? {});
    const payment = await this.service.cancel(id, body, this.actor(request));
    return reply.code(200).send(payment);
  };

  // ----- Project-scoped -----

  listForProject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const query = listPaymentsQuerySchema.parse(request.query);
    const result = await this.service.listForProject(id, query);
    return reply.code(200).send(result);
  };

  getProjectSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const summary = await this.service.getProjectSummary(id);
    return reply.code(200).send(summary);
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
