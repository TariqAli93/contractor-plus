import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProjectsService } from './projects.service.js';
import {
  cancelProjectBodySchema,
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  unlinkContractBodySchema,
  updateProjectSchema,
} from './projects.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listProjectsQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const project = await this.service.getById(id);
    return reply.code(200).send(project);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createProjectSchema.parse(request.body);
    const project = await this.service.create(body, this.actor(request));
    return reply.code(201).send(project);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const body = updateProjectSchema.parse(request.body);
    const project = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(project);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
  };

  // ----- Actions -----

  start = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const project = await this.service.start(id, this.actor(request));
    return reply.code(200).send(project);
  };

  pause = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const project = await this.service.pause(id, this.actor(request));
    return reply.code(200).send(project);
  };

  resume = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const project = await this.service.resume(id, this.actor(request));
    return reply.code(200).send(project);
  };

  complete = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const project = await this.service.complete(id, this.actor(request));
    return reply.code(200).send(project);
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const body = cancelProjectBodySchema.parse(request.body ?? {});
    const project = await this.service.cancel(id, body, this.actor(request));
    return reply.code(200).send(project);
  };

  unlinkContract = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = projectIdParamSchema.parse(request.params);
    const body = unlinkContractBodySchema.parse(request.body ?? {});
    const project = await this.service.unlinkFromContract(id, body.reason, this.actor(request));
    return reply.code(200).send(project);
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
