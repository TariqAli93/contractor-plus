import type { PrismaClient } from '@prisma/client';
import { RoleName } from '@contractor-plus/shared';
import { ALL_PERMISSION_KEYS } from './rbac.catalog.js';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error.js';

// Short-TTL, process-wide cache of live user status/role. An access token lives
// ~15 minutes and carries a role claim; without a live check, a user deactivated
// or demoted mid-token keeps their old access until it expires. This bounds that
// window to a few seconds while keeping hot AI paths cheap.
const LIVE_USER_TTL_MS = 15_000;
const liveUserCache = new Map<string, { active: boolean; role: string; expiresAt: number }>();

// Resolves the effective permission keys for a role. OWNER always resolves to
// the full catalog (super-admin) regardless of stored rows, guaranteeing it can
// never lose effective full access.
export class AccessService {
  constructor(private readonly prisma: PrismaClient) {}

  async permissionsForRole(roleName: string): Promise<string[]> {
    if (roleName === RoleName.OWNER) return [...ALL_PERMISSION_KEYS];
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { name: roleName }, permission: { isActive: true } },
      select: { permission: { select: { key: true } } },
    });
    return rows.map((r) => r.permission.key);
  }

  /**
   * Re-validate a user against the DB (active + not soft-deleted) and return their
   * CURRENT role name — NOT the (possibly stale) role baked into the access token.
   * Used by sensitive AI authorization so a deactivation or role change takes
   * effect within seconds, not when the token expires. Cached briefly per user to
   * keep the hot path cheap. Throws UnauthorizedError if the user is gone or
   * deactivated.
   */
  async liveUserRole(userId: string): Promise<string> {
    const now = Date.now();
    const cached = liveUserCache.get(userId);
    if (cached && cached.expiresAt > now) {
      if (!cached.active) throw new UnauthorizedError('الحساب معطّل أو غير موجود.', 'USER_INACTIVE');
      return cached.role;
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { isActive: true, role: { select: { name: true } } },
    });
    const active = !!user?.isActive;
    const role = user?.role.name ?? '';
    liveUserCache.set(userId, { active, role, expiresAt: now + LIVE_USER_TTL_MS });
    if (!active) throw new UnauthorizedError('الحساب معطّل أو غير موجود.', 'USER_INACTIVE');
    return role;
  }
}
