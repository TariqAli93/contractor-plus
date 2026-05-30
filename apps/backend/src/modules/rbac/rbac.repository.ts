import type { Permission, Prisma, PrismaClient, Role } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type RoleWithCounts = Role & { _count: { users: number; permissions: number } };

export class RbacRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findRoles(client: DbClient = this.prisma): Promise<RoleWithCounts[]> {
    return client.role.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } }, permissions: true } } },
    });
  }

  findRoleById(id: string, client: DbClient = this.prisma): Promise<RoleWithCounts | null> {
    return client.role.findUnique({
      where: { id },
      include: { _count: { select: { users: { where: { deletedAt: null } }, permissions: true } } },
    });
  }

  findRoleByName(name: string, client: DbClient = this.prisma): Promise<Role | null> {
    return client.role.findUnique({ where: { name } });
  }

  createRole(data: Prisma.RoleCreateInput, client: DbClient = this.prisma): Promise<Role> {
    return client.role.create({ data });
  }

  updateRole(id: string, data: Prisma.RoleUpdateInput, client: DbClient = this.prisma): Promise<Role> {
    return client.role.update({ where: { id }, data });
  }

  deleteRole(id: string, client: DbClient = this.prisma): Promise<Role> {
    return client.role.delete({ where: { id } });
  }

  // ---- Permissions ----

  findPermissions(client: DbClient = this.prisma): Promise<Permission[]> {
    return client.permission.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  findPermissionsByKeys(keys: string[], client: DbClient = this.prisma): Promise<Permission[]> {
    return client.permission.findMany({ where: { key: { in: keys } } });
  }

  rolePermissionKeys(roleId: string, client: DbClient = this.prisma): Promise<Array<{ permission: { key: string } }>> {
    return client.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
  }

  // Transactional full replace of a role's permission set.
  async replaceRolePermissions(roleId: string, permissionIds: string[], client: DbClient = this.prisma): Promise<void> {
    await client.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await client.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  // Additive assign (used by the seeder — never removes existing rows).
  async addRolePermissions(roleId: string, permissionIds: string[], client: DbClient = this.prisma): Promise<void> {
    if (permissionIds.length === 0) return;
    await client.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }

  // All role->permission key pairs, for building the matrix in one query.
  rolePermissionPairs(client: DbClient = this.prisma): Promise<Array<{ role: { name: string }; permission: { key: string } }>> {
    return client.rolePermission.findMany({
      select: { role: { select: { name: true } }, permission: { select: { key: true } } },
    });
  }
}
