import {
  PaymentStatus,
  type Payment,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { PaymentsRepository } from './payments.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CancelPaymentBody,
  CreatePaymentInput,
  ListPaymentsQuery,
  MarkPaidBody,
  UpdatePaymentInput,
} from './payments.schemas.js';
import type { ProjectPaymentSummary } from './payments.types.js';

const PAYMENT = 'Payment';
const LATEST_PAYMENTS_LIMIT = 10;

// Payment lifecycle:
//
//   PENDING  ──/mark-paid──►  PAID       (terminal)
//      │
//      └──/cancel────────►  CANCELLED   (terminal)
//
// LATE is a derived state: a stored PENDING payment whose dueDate has passed.
// This module never persists LATE — list filters and summary counts compute
// it from `status=PENDING AND dueDate < now`. If a LATE row exists (e.g. set
// by an external job), mark-paid and cancel still accept it as input.
//
// PATCH never touches status or paymentDate. Editing a PAID or CANCELLED
// payment is rejected. DELETE is soft-delete and is allowed in any status.

export class PaymentsService {
  private readonly repo: PaymentsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new PaymentsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- CRUD ----------

  async list(query: ListPaymentsQuery): Promise<Paginated<Payment>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        projectId: query.projectId,
        status: query.status,
        late: query.late,
        dueDateFrom: query.dueDateFrom,
        dueDateTo: query.dueDateTo,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({
        search: query.search,
        projectId: query.projectId,
        status: query.status,
        late: query.late,
        dueDateFrom: query.dueDateFrom,
        dueDateTo: query.dueDateTo,
      }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<Payment> {
    const payment = await this.repo.findById(id);
    if (!payment) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async create(data: CreatePaymentInput, actor: AuditActor): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertProjectHasContract(tx, data.projectId);

      const created = await this.repo.create(
        {
          projectId: data.projectId,
          amount: data.amount,
          dueDate: data.dueDate,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          // status defaults to PENDING via schema
        },
        tx,
      );

      await this.audit.log(
        actor,
        { action: 'CREATE', entity: PAYMENT, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async update(
    id: string,
    data: UpdatePaymentInput,
    actor: AuditActor,
  ): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
      if (this.isTerminal(existing.status)) {
        throw new ConflictError(
          `Cannot edit a payment in terminal status ${existing.status}`,
          'PAYMENT_TERMINAL',
        );
      }

      const updated = await this.repo.update(id, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PAYMENT,
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
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: PAYMENT, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- Actions ----------

  async markPaid(id: string, body: MarkPaidBody, actor: AuditActor): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
      if (
        existing.status !== PaymentStatus.PENDING &&
        existing.status !== PaymentStatus.LATE
      ) {
        throw new ConflictError(
          `Cannot mark payment as paid in status ${existing.status}`,
          'PAYMENT_NOT_PAYABLE',
        );
      }

      const previousStatus = existing.status;
      const updated = await this.repo.update(
        id,
        {
          status: PaymentStatus.PAID,
          paymentDate: body.paymentDate,
          ...(body.method !== undefined && { method: body.method }),
          ...(body.reference !== undefined && { reference: body.reference }),
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PAYMENT,
          entityId: id,
          oldValues: toJsonValue({
            status: previousStatus,
            paymentDate: existing.paymentDate,
            method: existing.method,
            reference: existing.reference,
          }),
          newValues: toJsonValue({
            event: 'marked_paid',
            status: updated.status,
            paymentDate: updated.paymentDate,
            method: updated.method,
            reference: updated.reference,
            previousStatus,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  async cancel(id: string, body: CancelPaymentBody, actor: AuditActor): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
      if (this.isTerminal(existing.status)) {
        throw new ConflictError(
          `Cannot cancel payment in status ${existing.status}`,
          'PAYMENT_NOT_CANCELLABLE',
        );
      }

      const previousStatus = existing.status;
      const updated = await this.repo.update(id, { status: PaymentStatus.CANCELLED }, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PAYMENT,
          entityId: id,
          oldValues: toJsonValue({ status: previousStatus }),
          newValues: toJsonValue({
            event: 'cancelled',
            reason: body.reason ?? null,
            previousStatus,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  // ---------- Project-scoped views ----------

  async listForProject(
    projectId: string,
    query: ListPaymentsQuery,
  ): Promise<Paginated<Payment>> {
    await this.assertProjectExists(this.prisma, projectId);
    return this.list({ ...query, projectId });
  }

  async getProjectSummary(projectId: string): Promise<ProjectPaymentSummary> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        contract: { select: { id: true, contractNumber: true, totalPrice: true } },
      },
    });
    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

    const now = new Date();
    const [totalPaid, pendingCount, lateCount, paidCount, cancelledCount, latestPayments] =
      await Promise.all([
        this.repo.sumPaidForProject(projectId),
        this.repo.countPendingNotLateForProject(projectId, now),
        this.repo.countLateForProject(projectId, now),
        this.repo.countByStatusForProject(projectId, PaymentStatus.PAID),
        this.repo.countByStatusForProject(projectId, PaymentStatus.CANCELLED),
        this.repo.latestForProject(projectId, LATEST_PAYMENTS_LIMIT),
      ]);

    const contractTotal = project.contract ? Number(project.contract.totalPrice) : null;
    const remainingBalance =
      contractTotal !== null ? round2(contractTotal - totalPaid) : null;
    const collectionPercentage =
      contractTotal !== null && contractTotal > 0
        ? round2((totalPaid / contractTotal) * 100)
        : null;

    return {
      projectId,
      contractId: project.contract?.id ?? null,
      contractNumber: project.contract?.contractNumber ?? null,
      contractTotal,
      totalPaid: round2(totalPaid),
      remainingBalance,
      collectionPercentage,
      pendingPayments: pendingCount,
      latePayments: lateCount,
      paidPayments: paidCount,
      cancelledPayments: cancelledCount,
      latestPayments,
    };
  }

  // ---------- Guards ----------

  private isTerminal(status: PaymentStatus): boolean {
    return status === PaymentStatus.PAID || status === PaymentStatus.CANCELLED;
  }

  private async assertProjectExists(
    tx: Prisma.TransactionClient | PrismaClient,
    id: string,
  ): Promise<void> {
    const p = await tx.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
  }

  private async assertProjectHasContract(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const p = await tx.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, contractId: true },
    });
    if (!p) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
    if (!p.contractId) {
      throw new ConflictError(
        'Project has no linked contract — payments require a contract',
        'PROJECT_HAS_NO_CONTRACT',
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
