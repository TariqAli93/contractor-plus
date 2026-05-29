import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MaterialsService } from './materials.service.js';
import {
  createMaterialSchema,
  listMaterialsQuerySchema,
  updateMaterialSchema,
} from './materials.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listMaterialsQuerySchema.parse(request.query);
    const result = await this.service.list(query);
    return reply.code(200).send(result);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const material = await this.service.getById(id);
    return reply.code(200).send(material);
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createMaterialSchema.parse(request.body);
    const material = await this.service.create(body, this.actor(request));
    return reply.code(201).send(material);
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateMaterialSchema.parse(request.body);
    const material = await this.service.update(id, body, this.actor(request));
    return reply.code(200).send(material);
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.softDelete(id, this.actor(request));
    return reply.code(204).send();
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
