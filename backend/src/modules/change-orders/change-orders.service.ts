import { ChangeOrderStatus, type ChangeOrder, type Prisma, type PrismaClient } from '@prisma/client';
import { ChangeOrdersRepository } from './change-orders.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import { money, round, toMoneyString } from '../../lib/money.js';
import type {
  CreateChangeOrderInput,
  ListChangeOrdersQuery,
  UpdateChangeOrderInput,
} from './change-orders.schemas.js';

const CHANGE_ORDER = 'ChangeOrder';

/** Contract value after approved change orders (computed, money as strings). */
export interface ChangeOrderSummary {
  contractId: string;
  originalTotal: string;
  approvedDelta: string;
  revisedTotal: string;
  draftCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export class ChangeOrdersService {
  private readonly repo: ChangeOrdersRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ChangeOrdersRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- reads ----------

  async list(query: ListChangeOrdersQuery): Promise<Paginated<ChangeOrder>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        contractId: query.contractId,
        status: query.status,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({ contractId: query.contractId, status: query.status }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<ChangeOrder> {
    const co = await this.repo.findById(id);
    if (!co) throw new NotFoundError('ChangeOrder', 'CHANGE_ORDER_NOT_FOUND');
    return co;
  }

  async listForContract(
    contractId: string,
    query: ListChangeOrdersQuery,
  ): Promise<Paginated<ChangeOrder>> {
    await this.getContractOrThrow(this.prisma, contractId);
    return this.list({ ...query, contractId });
  }

  async summaryForContract(contractId: string): Promise<ChangeOrderSummary> {
    const contract = await this.getContractOrThrow(this.prisma, contractId);
    const [approvedDelta, draftCount, approvedCount, rejectedCount] = await Promise.all([
      this.repo.sumApproved(contractId),
      this.repo.countByStatus(contractId, ChangeOrderStatus.DRAFT),
      this.repo.countByStatus(contractId, ChangeOrderStatus.APPROVED),
      this.repo.countByStatus(contractId, ChangeOrderStatus.REJECTED),
    ]);
    const revised = money(contract.totalPrice).plus(money(approvedDelta));
    return {
      contractId,
      originalTotal: toMoneyString(contract.totalPrice),
      approvedDelta: toMoneyString(approvedDelta),
      revisedTotal: toMoneyString(revised),
      draftCount,
      approvedCount,
      rejectedCount,
    };
  }

  // ---------- writes ----------

  async create(data: CreateChangeOrderInput, actor: AuditActor): Promise<ChangeOrder> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.getContractOrThrow(tx, data.contractId);
      // You amend an APPROVED contract; a DRAFT is still edited directly, and a
      // CANCELLED contract can't be amended.
      if (contract.status !== 'APPROVED') {
        throw new ConflictError(
          'يمكن إضافة أمر تغيير على عقد معتمد فقط.',
          'CONTRACT_NOT_APPROVED_FOR_CO',
        );
      }
      const number = await this.repo.nextNumber(data.contractId, tx);
      const created = await this.repo.create(
        {
          contractId: data.contractId,
          number,
          title: data.title,
          description: data.description,
          amount: round(money(data.amount)),
          status: ChangeOrderStatus.DRAFT,
        },
        tx,
      );
      await this.audit.log(
        actor,
        { action: 'CREATE', entity: CHANGE_ORDER, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async update(
    id: string,
    data: UpdateChangeOrderInput,
    actor: AuditActor,
  ): Promise<ChangeOrder> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('ChangeOrder', 'CHANGE_ORDER_NOT_FOUND');
      this.assertDraft(existing);

      const updated = await this.repo.update(
        id,
        {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.amount !== undefined && { amount: round(money(data.amount)) }),
        },
        tx,
      );
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CHANGE_ORDER,
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  approve(id: string, actor: AuditActor): Promise<ChangeOrder> {
    return this.transition(id, actor, ChangeOrderStatus.APPROVED, 'approved');
  }

  reject(id: string, actor: AuditActor): Promise<ChangeOrder> {
    return this.transition(id, actor, ChangeOrderStatus.REJECTED, 'rejected');
  }

  async softDelete(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('ChangeOrder', 'CHANGE_ORDER_NOT_FOUND');
      this.assertDraft(existing); // an approved/rejected order is a permanent record
      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: CHANGE_ORDER, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- helpers ----------

  private transition(
    id: string,
    actor: AuditActor,
    target: ChangeOrderStatus,
    event: string,
  ): Promise<ChangeOrder> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('ChangeOrder', 'CHANGE_ORDER_NOT_FOUND');
      this.assertDraft(existing);
      const updated = await this.repo.update(
        id,
        {
          status: target,
          ...(target === ChangeOrderStatus.APPROVED && { approvedAt: new Date() }),
        },
        tx,
      );
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CHANGE_ORDER,
          entityId: id,
          oldValues: toJsonValue({ status: existing.status }),
          newValues: toJsonValue({ event, status: target }),
        },
        tx,
      );
      return updated;
    });
  }

  private assertDraft(co: ChangeOrder): void {
    if (co.status !== ChangeOrderStatus.DRAFT) {
      throw new ConflictError(
        'لا يمكن تعديل أمر تغيير بعد اعتماده أو رفضه.',
        'CHANGE_ORDER_NOT_DRAFT',
      );
    }
  }

  private async getContractOrThrow(
    tx: Prisma.TransactionClient | PrismaClient,
    contractId: string,
  ): Promise<{ id: string; status: string; totalPrice: Prisma.Decimal }> {
    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, totalPrice: true },
    });
    if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
    return contract;
  }
}
