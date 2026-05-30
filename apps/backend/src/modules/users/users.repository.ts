import type { Prisma, PrismaClient, Role, User } from '@prisma/client';
import type { UserListArgs } from './users.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UserWithRole = User & { role: Role };

export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<UserWithRole | null> {
    return client.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
  }

  // Username uniqueness is global (the DB unique index covers soft-deleted rows
  // too), so this intentionally ignores deletedAt.
  findByUsername(username: string, client: DbClient = this.prisma): Promise<User | null> {
    return client.user.findUnique({ where: { username } });
  }

  findByEmail(email: string, client: DbClient = this.prisma): Promise<User | null> {
    return client.user.findUnique({ where: { email } });
  }

  findRoleByName(name: string, client: DbClient = this.prisma): Promise<Role | null> {
    return client.role.findUnique({ where: { name } });
  }

  findMany(args: UserListArgs): Promise<UserWithRole[]> {
    return this.prisma.user.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      include: { role: true },
      skip: args.skip,
      take: args.take,
    });
  }

  count(args: UserListArgs): Promise<number> {
    return this.prisma.user.count({ where: this.buildWhere(args) });
  }

  create(
    data: Prisma.UserUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<UserWithRole> {
    return client.user.create({ data, include: { role: true } });
  }

  update(
    id: string,
    data: Prisma.UserUncheckedUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<UserWithRole> {
    return client.user.update({ where: { id }, data, include: { role: true } });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<User> {
    return client.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  private buildWhere(args: UserListArgs): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (args.role) where.role = { name: args.role };
    if (args.isActive !== undefined) where.isActive = args.isActive;
    if (args.search) {
      where.OR = [
        { username: { contains: args.search, mode: 'insensitive' } },
        { fullName: { contains: args.search, mode: 'insensitive' } },
        { email: { contains: args.search, mode: 'insensitive' } },
        { phone: { contains: args.search } },
      ];
    }
    return where;
  }
}
