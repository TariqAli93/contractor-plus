import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.service.js';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
} from './auth.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import type { RequestContext } from './auth.types.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const result = await this.service.login(body.username, body.password, this.ctx(request));
    return reply.code(200).send(result);
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = refreshSchema.parse(request.body);
    const tokens = await this.service.refresh(body.refreshToken, this.ctx(request));
    return reply.code(200).send(tokens);
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = logoutSchema.parse(request.body);
    await this.service.logout(body.refreshToken, this.ctx(request));
    return reply.code(204).send();
  };

  logoutAll = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) throw new UnauthorizedError();
    await this.service.logoutAll(request.user.id, this.ctx(request));
    return reply.code(204).send();
  };

  me = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) throw new UnauthorizedError();
    const profile = await this.service.me(request.user.id);
    return reply.code(200).send(profile);
  };

  private ctx(request: FastifyRequest): RequestContext {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
  }
}
