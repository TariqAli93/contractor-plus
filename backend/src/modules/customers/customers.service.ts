import type { Customer, Prisma, PrismaClient } from '@prisma/client';
import { CustomersRepository } from './customers.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './customers.schemas.js';

const ENTITY = 'Customer';

export class CustomersService {
  private readonly repo: CustomersRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new CustomersRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  async list(query: ListCustomersQuery): Promise<Paginated<Customer>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count(query.search),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) throw new NotFoundError(ENTITY, 'CUSTOMER_NOT_FOUND');
    return customer;
  }

  /**
   * Live customers sharing a phone number — the duplicate-detection lookup used
   * by the quick-entry / AI create flows to warn before creating a twin. Empty
   * phone → no duplicates.
   */
  async findDuplicatesByPhone(phone: string | null | undefined): Promise<Customer[]> {
    const trimmed = (phone ?? '').trim();
    if (!trimmed) return [];
    return this.repo.findByPhone(trimmed);
  }

  async create(data: CreateCustomerInput, actor: AuditActor): Promise<Customer> {
    return this.prisma.$transaction((tx) => this.createWithinTx(tx, data, actor));
  }

  /** Tx-aware create — lets a caller compose customer creation with
   *  a contract + project in a single all-or-nothing transaction. */
  async createWithinTx(
    tx: Prisma.TransactionClient,
    data: CreateCustomerInput,
    actor: AuditActor,
  ): Promise<Customer> {
    const created = await this.repo.create(data, tx);
    await this.audit.log(
      actor,
      {
        action: 'CREATE',
        entity: ENTITY,
        entityId: created.id,
        newValues: toJsonValue(created),
      },
      tx,
    );
    return created;
  }

  async update(id: string, data: UpdateCustomerInput, actor: AuditActor): Promise<Customer> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError(ENTITY, 'CUSTOMER_NOT_FOUND');

      const updated = await this.repo.update(id, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async softDelete(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError(ENTITY, 'CUSTOMER_NOT_FOUND');

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ENTITY,
          entityId: id,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }
}
