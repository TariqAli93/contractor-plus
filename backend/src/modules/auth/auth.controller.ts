import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.service.js';
import { loginSchema } from './auth.schemas.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import { setAuthCookies, clearAuthCookies, readRefreshCookie } from '../../lib/auth-cookies.js';
import type { RequestContext } from './auth.types.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const result = await this.service.login(body.username, body.password, this.ctx(request));
    // The refresh token leaves the service but never the response body — it is
    // planted in an HttpOnly cookie. Only the in-memory access token is returned.
    setAuthCookies(reply, result.tokens.refreshToken);
    return reply.code(200).send({
      user: result.user,
      tokens: { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn },
    });
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawRefreshToken = readRefreshCookie(request);
    if (!rawRefreshToken) {
      throw new UnauthorizedError('Invalid or expired refresh token', 'REFRESH_INVALID');
    }
    const tokens = await this.service.refresh(rawRefreshToken, this.ctx(request));
    // Rotation: the service already revoked the old token; replant the new one.
    setAuthCookies(reply, tokens.refreshToken);
    return reply.code(200).send({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawRefreshToken = readRefreshCookie(request);
    if (rawRefreshToken) {
      await this.service.logout(rawRefreshToken, this.ctx(request));
    }
    // Idempotent — a missing/expired cookie still clears client state and 204s.
    clearAuthCookies(reply);
    return reply.code(204).send();
  };

  logoutAll = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) throw new UnauthorizedError();
    await this.service.logoutAll(request.user.id, this.ctx(request));
    clearAuthCookies(reply);
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
