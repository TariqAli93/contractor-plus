import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContractsService } from './contracts.service.js';
import {
  approveContractBodySchema,
  cancelContractBodySchema,
  contractIdParamSchema,
  createContractSchema,
  createProjectFromContractBodySchema,
  listContractsQuerySchema,
  updateContractSchema,
} from './contracts.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listContractsQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const contract = await this.service.getById(id);
    return reply.code(200).send(contract);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createContractSchema.parse(request.body);
    const contract = await this.service.create(body, this.actor(request));
    return reply.code(201).send(contract);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const body = updateContractSchema.parse(request.body);
    const contract = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(contract);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  generateEstimate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const estimate = await this.service.generateEstimate(id, this.actor(request));
    return reply.code(200).send(estimate);
  };

  approve = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const body = approveContractBodySchema.parse(request.body ?? {});
    const contract = await this.service.approve(id, body, this.actor(request));
    return reply.code(200).send(contract);
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const body = cancelContractBodySchema.parse(request.body ?? {});
    const contract = await this.service.cancel(id, body, this.actor(request));
    return reply.code(200).send(contract);
  };

  createProject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = contractIdParamSchema.parse(request.params);
    const body = createProjectFromContractBodySchema.parse(request.body ?? {});
    const project = await this.service.createProject(id, body, this.actor(request));
    return reply.code(201).send(project);
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
