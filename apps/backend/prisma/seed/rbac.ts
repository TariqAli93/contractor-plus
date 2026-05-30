import type { PrismaClient } from '@prisma/client';
import { RoleName } from '@contractor-plus/shared';
import {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
} from '../../src/modules/rbac/rbac.catalog.js';

// Idempotent RBAC seeding:
//   1. Upsert every catalog permission (stable keys).
//   2. Deactivate DB permissions that are no longer in the catalog (never
//      delete — preserves history + any custom RolePermission rows).
//   3. Mark OWNER protected.
//   4. ADDITIVELY assign each system role its default permissions — existing
//      rows (including manual edits) are never removed here.
export async function seedRbac(prisma: PrismaClient) {
  // 1. Permissions.
  for (let i = 0; i < PERMISSION_CATALOG.length; i++) {
    const p = PERMISSION_CATALOG[i]!;
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, action: p.action, displayName: p.displayName, sortOrder: i, isSystem: true, isActive: true },
      create: { key: p.key, module: p.module, action: p.action, displayName: p.displayName, sortOrder: i, isSystem: true, isActive: true },
    });
  }
  // 2. Deactivate stale permissions (removed from catalog).
  const keySet = new Set(ALL_PERMISSION_KEYS);
  const existing = await prisma.permission.findMany({ select: { id: true, key: true } });
  const staleIds = existing.filter((p) => !keySet.has(p.key)).map((p) => p.id);
  if (staleIds.length > 0) {
    await prisma.permission.updateMany({ where: { id: { in: staleIds } }, data: { isActive: false } });
  }

  // 3. OWNER is protected (cannot be deleted).
  await prisma.role.update({ where: { name: RoleName.OWNER }, data: { isProtected: true } });

  // 4. Assign default permissions per system role (additive).
  const permByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );
  let assigned = 0;
  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    const keys = DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
    const data = keys
      .map((k) => permByKey.get(k))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    const res = await prisma.rolePermission.createMany({ data, skipDuplicates: true });
    assigned += res.count;
  }

  console.log(`  ${PERMISSION_CATALOG.length} permissions, ${assigned} new role-permission links`);
}
