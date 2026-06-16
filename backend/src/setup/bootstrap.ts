/**
 * Production bootstrap — invoked by the Electron main process as a child process
 * AFTER `prisma migrate deploy` has created the schema. It reads the first
 * user's credentials from STDIN as JSON (never argv/env, so the PIN never shows
 * up in process listings or logs) and:
 *
 *   1. Upserts the system roles (OWNER, ADMIN, …) with Arabic display metadata.
 *   2. Seeds the RBAC permission catalog + default role-permission links.
 *   3. Seeds the default currency (IQD) and a blank company profile.
 *   4. Creates the first user as OWNER (super admin) with a bcrypt-hashed PIN.
 *
 * Idempotent: re-running is safe. Roles/permissions/settings converge; the owner
 * is only created when the users table is empty (so a second run never adds a
 * duplicate or a rogue super admin).
 *
 * This module is intentionally self-contained: it builds its own PrismaClient
 * (reading DATABASE_URL from the injected env) and does NOT import
 * `config/env.ts` or `lib/prisma.ts`, both of which validate the FULL server env
 * (JWT secret, CORS, …) and would `process.exit(1)` in this minimal context.
 *
 * Output contract (consumed by the desktop bootstrap-runner):
 *   success → stdout: `{"ok":true,"ownerCreated":<bool>}`  exit 0
 *   failure → stderr: `{"ok":false,"error":"<message>"}`    exit 1
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { RoleName } from '@contractor-plus/shared';
import {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
} from '../modules/rbac/rbac.catalog.js';

const BCRYPT_ROUNDS = 12;

interface OwnerInput {
  username: string;
  pin: string;
  fullName: string;
}

// Arabic display metadata for the seeded system roles — mirrors prisma/seed.ts
// so the desktop bootstrap and the dev seed converge on the same labels.
const ROLE_META: Record<string, { displayName: string; description: string; sortOrder: number }> = {
  [RoleName.OWNER]: { displayName: 'المالك', description: 'صلاحيات كاملة على النظام', sortOrder: 1 },
  [RoleName.ADMIN]: { displayName: 'مدير', description: 'إدارة العمليات والمستخدمين', sortOrder: 2 },
  [RoleName.ACCOUNTANT]: { displayName: 'محاسب', description: 'العقود والمصاريف والدفعات', sortOrder: 3 },
  [RoleName.ENGINEER]: { displayName: 'مهندس', description: 'المشاريع والمصاريف', sortOrder: 4 },
  [RoleName.VIEWER]: { displayName: 'مشاهد', description: 'اطلاع فقط', sortOrder: 5 },
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function validateOwner(raw: unknown): OwnerInput {
  if (!raw || typeof raw !== 'object') throw new Error('OWNER payload must be a JSON object');
  const obj = raw as Record<string, unknown>;
  const username = String(obj.username ?? '').trim().toLowerCase();
  const pin = String(obj.pin ?? '');
  if (username.length < 3 || username.length > 50) throw new Error('username must be 3–50 characters');
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error('username may contain only letters, numbers, dot, underscore, dash');
  }
  if (!/^\d{4,}$/.test(pin)) throw new Error('PIN must be at least 4 digits');
  const fullNameRaw = typeof obj.fullName === 'string' ? obj.fullName.trim() : '';
  return { username, pin, fullName: fullNameRaw.length > 0 ? fullNameRaw : username };
}

async function seedRoles(prisma: PrismaClient): Promise<void> {
  for (const name of Object.values(RoleName)) {
    const meta = ROLE_META[name];
    if (!meta) continue;
    await prisma.role.upsert({
      where: { name },
      update: {
        displayName: meta.displayName,
        description: meta.description,
        sortOrder: meta.sortOrder,
        isSystem: true,
      },
      create: {
        name,
        displayName: meta.displayName,
        description: meta.description,
        sortOrder: meta.sortOrder,
        isSystem: true,
      },
    });
  }
}

async function seedRbac(prisma: PrismaClient): Promise<void> {
  // 1. Upsert every catalog permission (stable keys).
  for (let i = 0; i < PERMISSION_CATALOG.length; i++) {
    const p = PERMISSION_CATALOG[i];
    if (!p) continue;
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, action: p.action, displayName: p.displayName, sortOrder: i, isSystem: true, isActive: true },
      create: { key: p.key, module: p.module, action: p.action, displayName: p.displayName, sortOrder: i, isSystem: true, isActive: true },
    });
  }
  // 2. Deactivate stale permissions (removed from catalog) — never delete.
  const keySet = new Set(ALL_PERMISSION_KEYS);
  const existing = await prisma.permission.findMany({ select: { id: true, key: true } });
  const staleIds = existing.filter((p) => !keySet.has(p.key)).map((p) => p.id);
  if (staleIds.length > 0) {
    await prisma.permission.updateMany({ where: { id: { in: staleIds } }, data: { isActive: false } });
  }
  // 3. OWNER is protected.
  await prisma.role.update({ where: { name: RoleName.OWNER }, data: { isProtected: true } });
  // 4. Assign default permissions per system role (additive).
  const permByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );
  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    const keys = DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
    const data = keys
      .map((k) => permByKey.get(k))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (data.length > 0) {
      await prisma.rolePermission.createMany({ data, skipDuplicates: true });
    }
  }
}

async function seedSettings(prisma: PrismaClient): Promise<void> {
  // Iraqi Dinar as the single default currency; blank company profile singleton.
  await prisma.currency.deleteMany({ where: { code: { in: ['SAR', 'USD'] } } });
  await prisma.currency.upsert({
    where: { code: 'IQD' },
    update: { name: 'Iraqi Dinar', symbol: 'د.ع', symbolPosition: 'AFTER', decimalPrecision: 0, thousandSeparator: ',', decimalSeparator: '.', isActive: true, isDefault: true },
    create: { code: 'IQD', name: 'Iraqi Dinar', symbol: 'د.ع', symbolPosition: 'AFTER', decimalPrecision: 0, thousandSeparator: ',', decimalSeparator: '.', isActive: true, isDefault: true },
  });
  await prisma.companyProfile.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', companyName: '' } });
}

async function createOwner(prisma: PrismaClient, owner: OwnerInput): Promise<boolean> {
  // Only ever create the first user. If users already exist, setup has already
  // run — converge roles/permissions but don't add another super admin.
  const existing = await prisma.user.count();
  if (existing > 0) return false;

  const ownerRole = await prisma.role.findUnique({ where: { name: RoleName.OWNER } });
  if (!ownerRole) throw new Error('OWNER role missing after seeding');

  const passwordHash = await bcrypt.hash(owner.pin, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      username: owner.username,
      passwordHash,
      fullName: owner.fullName,
      roleId: ownerRole.id,
      isActive: true,
    },
  });
  return true;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON on stdin');
  }
  const owner = validateOwner(parsed);

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await seedRoles(prisma);
    await seedRbac(prisma);
    await seedSettings(prisma);
    const ownerCreated = await createOwner(prisma, owner);
    process.stdout.write(`${JSON.stringify({ ok: true, ownerCreated })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'bootstrap failed';
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
});
