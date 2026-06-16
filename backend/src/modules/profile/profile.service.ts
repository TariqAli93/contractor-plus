import type { PrismaClient, Role, User } from '@prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AccessService } from '../rbac/access.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { AppError } from '../../shared/errors/app-error.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { sha256 } from '../../lib/crypto.js';
import { toJsonValue } from '../../shared/utils/json.js';
import type { UserProfile } from '../auth/auth.schemas.js';
import type { ChangePasswordInput, UpdateProfileInput } from './profile.schemas.js';

const ENTITY = 'User';

type UserWithRole = User & { role: Role };

export class ProfileService {
  private readonly audit: AuditService;
  private readonly access: AccessService;

  constructor(private readonly prisma: PrismaClient) {
    this.audit = new AuditService(prisma);
    this.access = new AccessService(prisma);
  }

  async get(userId: string): Promise<UserProfile> {
    const user = await this.find(userId);
    return this.toProfile(user);
  }

  async update(userId: string, data: UpdateProfileInput, actor: AuditActor): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, include: { role: true } });
      if (!existing) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');

      if (data.email && data.email !== existing.email) {
        const clash = await tx.user.findUnique({ where: { email: data.email } });
        if (clash && clash.id !== userId) throw new ConflictError('Email already in use', 'EMAIL_TAKEN');
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { fullName: data.fullName, email: data.email, phone: data.phone },
        include: { role: true },
      });
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: userId,
          oldValues: toJsonValue({ fullName: existing.fullName, email: existing.email, phone: existing.phone }),
          newValues: toJsonValue({ fullName: updated.fullName, email: updated.email, phone: updated.phone, event: 'profile_update' }),
        },
        tx,
      );
      return this.toProfile(updated);
    });
  }

  async changePassword(userId: string, data: ChangePasswordInput, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null } });
      if (!user) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');

      const ok = await verifyPassword(data.currentPassword, user.passwordHash);
      // 400 (not 401) so the axios refresh interceptor doesn't kick in.
      if (!ok) throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');

      const passwordHash = await hashPassword(data.newPassword);
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });

      // Revoke every other refresh token; keep the caller's current one if sent.
      const keepHash = data.currentRefreshToken ? sha256(data.currentRefreshToken) : null;
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(keepHash ? { tokenHash: { not: keepHash } } : {}) },
        data: { revokedAt: new Date() },
      });

      await this.audit.log(
        actor,
        { action: 'UPDATE', entity: ENTITY, entityId: userId, newValues: toJsonValue({ event: 'password_change' }) },
        tx,
      );
    });
  }

  private async find(userId: string): Promise<UserWithRole> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: { role: true } });
    if (!user) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');
    return user;
  }

  private async toProfile(user: UserWithRole): Promise<UserProfile> {
    const permissions = await this.access.permissionsForRole(user.role.name);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role.name,
      roleDisplayName: user.role.displayName,
      permissions,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
