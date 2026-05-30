import type { PrismaClient } from '@prisma/client';
import { RoleName } from '@contractor-plus/shared';
import { ALL_PERMISSION_KEYS } from './rbac.catalog.js';

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
}
