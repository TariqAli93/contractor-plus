import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditService } from './audit.service.js';
import {
  auditLogIdParamSchema,
  entityHistoryParamSchema,
  entityHistoryQuerySchema,
  listAuditLogsQuerySchema,
  userHistoryParamSchema,
  userHistoryQuerySchema,
} from './audit.schemas.js';

export class AuditController {
  constructor(private readonly service: AuditService) {}

  listLogs = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listAuditLogsQuerySchema.parse(request.query);
    const result = await this.service.listLogs(query);
    return reply.code(200).send(result);
  };

  getLogById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = auditLogIdParamSchema.parse(request.params);
    const log = await this.service.getLogById(id);
    return reply.code(200).send(log);
  };

  getEntityHistory = async (request: FastifyRequest, reply: FastifyReply) => {
    const { entity, entityId } = entityHistoryParamSchema.parse(request.params);
    const query = entityHistoryQuerySchema.parse(request.query);
    const result = await this.service.getEntityHistory(entity, entityId, query);
    return reply.code(200).send(result);
  };

  getUserHistory = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = userHistoryParamSchema.parse(request.params);
    const query = userHistoryQuerySchema.parse(request.query);
    const result = await this.service.getUserHistory(userId, query);
    return reply.code(200).send(result);
  };
}
