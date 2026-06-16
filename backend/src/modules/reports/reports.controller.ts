import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ReportsService } from './reports.service.js';
import {
  cashFlowQuerySchema,
  delayedProjectsQuerySchema,
  listProjectProfitabilityQuerySchema,
  overduePaymentsQuerySchema,
  projectProfitabilityParamSchema,
} from './reports.schemas.js';

export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  dashboard = async (_request: FastifyRequest, reply: FastifyReply) => {
    const summary = await this.service.getDashboard();
    return reply.code(200).send(summary);
  };

  listProjectProfitability = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listProjectProfitabilityQuerySchema.parse(request.query);
    const result = await this.service.listProjectProfitability(query);
    return reply.code(200).send(result);
  };

  getProjectProfitability = async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = projectProfitabilityParamSchema.parse(request.params);
    const result = await this.service.getProjectProfitability(projectId);
    return reply.code(200).send(result);
  };

  cashFlow = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = cashFlowQuerySchema.parse(request.query);
    const result = await this.service.getCashFlow(query);
    return reply.code(200).send(result);
  };

  overduePayments = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = overduePaymentsQuerySchema.parse(request.query);
    const result = await this.service.getOverduePayments(query);
    return reply.code(200).send(result);
  };

  delayedProjects = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = delayedProjectsQuerySchema.parse(request.query);
    const result = await this.service.getDelayedProjects(query);
    return reply.code(200).send(result);
  };
}
