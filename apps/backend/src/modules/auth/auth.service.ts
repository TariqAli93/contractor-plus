import type { PrismaClient } from '@prisma/client';
import { AuthRepository, type UserWithRole } from './auth.repository.js';
import { verifyPassword } from '../../lib/password.js';
import { signAccessToken, accessTokenTtlSeconds } from '../../lib/jwt.js';
import { generateOpaqueToken, sha256 } from '../../lib/crypto.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';
import { env } from '../../config/env.js';
import type { LoginResponse, TokenPair, UserProfile } from './auth.schemas.js';
import type { RequestContext } from './auth.types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class AuthService {
  private readonly repo: AuthRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new AuthRepository(prisma);
  }

  async login(email: string, password: string, ctx: RequestContext): Promise<LoginResponse> {
    const user = await this.repo.findUserByEmail(email);

    // Constant-time-ish: only one generic error for all auth failures.
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const tokens = await this.issueTokens(user, ctx);
    await this.repo.updateLastLogin(user.id);

    return {
      user: this.toProfile({ ...user, lastLoginAt: new Date() }),
      tokens,
    };
  }

  async refresh(rawRefreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const tokenHash = sha256(rawRefreshToken);
    const existing = await this.repo.findActiveRefreshToken(tokenHash);
    if (!existing) {
      throw new UnauthorizedError('Invalid or expired refresh token', 'REFRESH_INVALID');
    }

    const user = await this.repo.findUserById(existing.userId);
    if (!user || !user.isActive) {
      await this.repo.revokeRefreshToken(existing.id, ctx.ipAddress);
      throw new UnauthorizedError('Account is not active', 'ACCOUNT_INACTIVE');
    }

    // Rotation: revoke the presented token, issue a fresh pair.
    await this.repo.revokeRefreshToken(existing.id, ctx.ipAddress);
    return this.issueTokens(user, ctx);
  }

  async logout(rawRefreshToken: string, ctx: RequestContext): Promise<void> {
    const tokenHash = sha256(rawRefreshToken);
    const existing = await this.repo.findActiveRefreshToken(tokenHash);
    if (existing) {
      await this.repo.revokeRefreshToken(existing.id, ctx.ipAddress);
    }
    // Idempotent — unknown/expired tokens are not an error.
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<void> {
    await this.repo.revokeAllUserRefreshTokens(userId, ctx.ipAddress);
  }

  async me(userId: string): Promise<UserProfile> {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account is not active', 'ACCOUNT_INACTIVE');
    }
    return this.toProfile(user);
  }

  private async issueTokens(user: UserWithRole, ctx: RequestContext): Promise<TokenPair> {
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role.name,
    });

    const refreshToken = generateOpaqueToken();
    const tokenHash = sha256(refreshToken);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY);

    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
      createdByIp: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenTtlSeconds(),
    };
  }

  private toProfile(user: UserWithRole): UserProfile {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role.name,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
