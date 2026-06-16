import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RbacService } from './rbac.service.js';
import { createRoleSchema, setRolePermissionsSchema, updateRoleSchema } from './rbac.schemas.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { AuditActor } from '../audit/audit.service.js';

export class RbacController {
  constructor(private readonly service: RbacService) {}

  getPermissions = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.getPermissions());
  };

  getMatrix = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.getMatrix());
  };

  listRoles = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(await this.service.listRoles());
  };

  getRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send(await this.service.getRole(id));
  };

  createRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createRoleSchema.parse(request.body);
    return reply.code(201).send(await this.service.createRole(body, this.actor(request)));
  };

  updateRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    return reply.code(200).send(await this.service.updateRole(id, body, this.actor(request)));
  };

  deleteRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    await this.service.deleteRole(id, this.actor(request));
    return reply.code(204).send();
  };

  getRolePermissions = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.code(200).send({ permissions: await this.service.getRolePermissions(id) });
  };

  setRolePermissions = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = setRolePermissionsSchema.parse(request.body);
    const permissions = await this.service.setRolePermissions(id, body, this.actor(request));
    return reply.code(200).send({ permissions });
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
