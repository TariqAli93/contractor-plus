import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SettingsService } from './settings.service.js';
import {
  createCurrencySchema,
  generalSettingsSchema,
  updateCompanyProfileSchema,
  updateCurrencySchema,
} from './settings.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  // ---------- general ----------

  getGeneral = async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await this.service.getGeneral();
    return reply.code(200).send(data);
  };

  updateGeneral = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = generalSettingsSchema.parse(request.body);
    const data = await this.service.updateGeneral(body, this.actor(request));
    return reply.code(200).send(data);
  };

  // ---------- company ----------

  getCompany = async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await this.service.getCompany();
    return reply.code(200).send(data);
  };

  updateCompany = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateCompanyProfileSchema.parse(request.body);
    const data = await this.service.updateCompany(body, this.actor(request));
    return reply.code(200).send(data);
  };

  // ---------- currencies ----------

  listCurrencies = async (_request: FastifyRequest, reply: FastifyReply) => {
    const items = await this.service.listCurrencies();
    return reply.code(200).send({ items });
  };

  createCurrency = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createCurrencySchema.parse(request.body);
    const data = await this.service.createCurrency(body, this.actor(request));
    return reply.code(201).send(data);
  };

  updateCurrency = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCurrencySchema.parse(request.body);
    const data = await this.service.updateCurrency(id, body, this.actor(request));
    return reply.code(200).send(data);
  };

  deleteCurrency = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.deleteCurrency(id, this.actor(request));
    return reply.code(204).send();
  };

  setDefaultCurrency = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const data = await this.service.setDefaultCurrency(id, this.actor(request));
    return reply.code(200).send(data);
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
