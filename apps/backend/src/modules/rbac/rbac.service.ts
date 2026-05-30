import type { Permission, PrismaClient } from '@prisma/client';
import { RoleName } from '@contractor-plus/shared';
import { RbacRepository, type RoleWithCounts } from './rbac.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { ForbiddenError } from '../../shared/errors/forbidden.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { PERMISSION_MODULES } from './rbac.catalog.js';
import type { CreateRoleInput, SetRolePermissionsInput, UpdateRoleInput } from './rbac.schemas.js';
import type { MatrixDto, PermissionDto, RoleDto } from './rbac.types.js';

const ROLE = 'Role';
const ROLE_PERMS = 'RolePermission';
const SYSTEM_ROLE_NAMES = new Set(Object.values(RoleName).map((r) => r.toLowerCase()));

export class RbacService {
  private readonly repo: RbacRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new RbacRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- Roles ----------

  async listRoles(): Promise<RoleDto[]> {
    return (await this.repo.findRoles()).map(toRoleDto);
  }

  async getRole(id: string): Promise<RoleDto> {
    const role = await this.repo.findRoleById(id);
    if (!role) throw new NotFoundError(ROLE, 'ROLE_NOT_FOUND');
    return toRoleDto(role);
  }

  async createRole(data: CreateRoleInput, actor: AuditActor): Promise<RoleDto> {
    // Reserved / system names are off-limits for custom roles.
    if (SYSTEM_ROLE_NAMES.has(data.name.toLowerCase())) {
      throw new ConflictError('Role name is reserved', 'ROLE_NAME_RESERVED');
    }
    return this.prisma.$transaction(async (tx) => {
      if (await this.repo.findRoleByName(data.name, tx)) {
        throw new ConflictError('Role name already exists', 'ROLE_NAME_TAKEN');
      }
      const created = await this.repo.createRole(
        {
          name: data.name,
          displayName: data.displayName,
          description: data.description,
          sortOrder: data.sortOrder ?? 100,
          isSystem: false,
          isProtected: false,
          isActive: true,
        },
        tx,
      );
      await this.audit.log(
        actor,
        { action: 'CREATE', entity: ROLE, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      const withCounts = await this.repo.findRoleById(created.id, tx);
      return toRoleDto(withCounts!);
    });
  }

  async updateRole(id: string, data: UpdateRoleInput, actor: AuditActor): Promise<RoleDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findRoleById(id, tx);
      if (!existing) throw new NotFoundError(ROLE, 'ROLE_NOT_FOUND');
      if (existing.isSystem && data.isActive === false) {
        throw new ForbiddenError('System roles cannot be deactivated', 'ROLE_PROTECTED');
      }
      await this.repo.updateRole(
        id,
        {
          displayName: data.displayName,
          description: data.description,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
        },
        tx,
      );
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ROLE,
          entityId: id,
          oldValues: toJsonValue({ displayName: existing.displayName, description: existing.description, sortOrder: existing.sortOrder, isActive: existing.isActive }),
          newValues: toJsonValue(data),
        },
        tx,
      );
      const reread = await this.repo.findRoleById(id, tx);
      return toRoleDto(reread!);
    });
  }

  async deleteRole(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findRoleById(id, tx);
      if (!existing) throw new NotFoundError(ROLE, 'ROLE_NOT_FOUND');
      if (existing.isSystem || existing.isProtected) {
        throw new ForbiddenError('System/protected roles cannot be deleted', 'ROLE_PROTECTED');
      }
      if (existing._count.users > 0) {
        throw new ConflictError('Role is assigned to users', 'ROLE_IN_USE');
      }
      await this.repo.deleteRole(id, tx); // cascades role_permissions
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: ROLE, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- Role permissions ----------

  async getRolePermissions(id: string): Promise<string[]> {
    const role = await this.repo.findRoleById(id);
    if (!role) throw new NotFoundError(ROLE, 'ROLE_NOT_FOUND');
    if (role.name === RoleName.OWNER) {
      // OWNER effectively holds everything.
      return (await this.repo.findPermissions()).map((p) => p.key);
    }
    return (await this.repo.rolePermissionKeys(id)).map((r) => r.permission.key);
  }

  async setRolePermissions(id: string, data: SetRolePermissionsInput, actor: AuditActor): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const role = await this.repo.findRoleById(id, tx);
      if (!role) throw new NotFoundError(ROLE, 'ROLE_NOT_FOUND');
      // OWNER can never lose effective full access.
      if (role.name === RoleName.OWNER) {
        throw new ForbiddenError('OWNER permissions cannot be modified', 'OWNER_IMMUTABLE');
      }

      const keys = Array.from(new Set(data.permissions));
      const found = await this.repo.findPermissionsByKeys(keys, tx);
      if (found.length !== keys.length) {
        const knownKeys = new Set(found.map((p) => p.key));
        const unknown = keys.filter((k) => !knownKeys.has(k));
        throw new ValidationError('Unknown permission keys', { permissions: unknown });
      }

      const before = (await this.repo.rolePermissionKeys(id, tx)).map((r) => r.permission.key);
      await this.repo.replaceRolePermissions(id, found.map((p) => p.id), tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ROLE_PERMS,
          entityId: id,
          oldValues: toJsonValue({ permissions: before }),
          newValues: toJsonValue({ permissions: keys }),
        },
        tx,
      );
      return keys;
    });
  }

  // ---------- Catalog / matrix ----------

  async getPermissions(): Promise<PermissionDto[]> {
    return (await this.repo.findPermissions()).map(toPermissionDto);
  }

  async getMatrix(): Promise<MatrixDto> {
    const [permissions, roles, pairs] = await Promise.all([
      this.repo.findPermissions(),
      this.repo.findRoles(),
      this.repo.rolePermissionPairs(),
    ]);

    // Group permissions by module, preserving catalog order.
    const byModule = new Map<string, PermissionDto[]>();
    for (const mod of PERMISSION_MODULES) byModule.set(mod, []);
    for (const perm of permissions) {
      if (!byModule.has(perm.module)) byModule.set(perm.module, []);
      byModule.get(perm.module)!.push(toPermissionDto(perm));
    }
    const modules = [...byModule.entries()]
      .filter(([, perms]) => perms.length > 0)
      .map(([key, perms]) => ({ key, permissions: perms }));

    // cells[roleName][key]
    const cells: Record<string, Record<string, boolean>> = {};
    for (const role of roles) cells[role.name] = {};
    for (const pair of pairs) {
      const row = (cells[pair.role.name] ??= {});
      row[pair.permission.key] = true;
    }
    // OWNER is super-admin: every permission is granted regardless of rows.
    const ownerRow = (cells[RoleName.OWNER] ??= {});
    for (const perm of permissions) ownerRow[perm.key] = true;

    return {
      modules,
      roles: roles.map((r) => ({ id: r.id, name: r.name, displayName: r.displayName, isSystem: r.isSystem, isProtected: r.isProtected })),
      cells,
    };
  }
}

function toRoleDto(role: RoleWithCounts): RoleDto {
  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    sortOrder: role.sortOrder,
    isSystem: role.isSystem,
    isProtected: role.isProtected,
    isActive: role.isActive,
    userCount: role._count.users,
    permissionCount: role._count.permissions,
  };
}

function toPermissionDto(p: Permission): PermissionDto {
  return { key: p.key, module: p.module, action: p.action, displayName: p.displayName, description: p.description };
}
