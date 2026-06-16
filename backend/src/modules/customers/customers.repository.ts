import type { Customer, Prisma, PrismaClient } from '@prisma/client';
import type { CustomerListArgs } from './customers.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class CustomersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
  }

  findMany(args: CustomerListArgs): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: this.buildWhere(args.search),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  count(search?: string): Promise<number> {
    return this.prisma.customer.count({ where: this.buildWhere(search) });
  }

  create(data: Prisma.CustomerCreateInput, client: DbClient = this.prisma): Promise<Customer> {
    return client.customer.create({ data });
  }

  update(
    id: string,
    data: Prisma.CustomerUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Customer> {
    return client.customer.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<Customer> {
    return client.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private buildWhere(search?: string): Prisma.CustomerWhereInput {
    if (!search) {
      return { deletedAt: null };
    }
    return {
      deletedAt: null,
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    };
  }
}
