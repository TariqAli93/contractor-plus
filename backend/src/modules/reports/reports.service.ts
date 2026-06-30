import type { PrismaClient } from '@prisma/client';
import { ProjectWithContractSummary, ReportsRepository } from './reports.repository.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import { money, toMoneyString, toMoneyStringOrNull, type Money } from '../../lib/money.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CashFlowQuery,
  DelayedProjectsQuery,
  ListProjectProfitabilityQuery,
  OverduePaymentsQuery,
} from './reports.schemas.js';
import type {
  CashFlowReport,
  DashboardSummary,
  DelayedProjectRow,
  OverduePaymentsByProject,
  ProjectProfitability,
} from './reports.types.js';

const RECENT_LIMIT = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Reports are pure aggregations. All queries inside each method run in parallel
// via Promise.all. Per-project rollups use Prisma groupBy keyed on projectId so
// a cost like "sum costs across these 20 projects" is exactly two SQL queries
// regardless of N. All money flows as Decimal (Money) end-to-end and is
// serialized to a fixed-precision string at the DTO boundary — no float drift.

export class ReportsService {
  private readonly repo: ReportsRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new ReportsRepository(prisma);
  }

  // ---------- Dashboard ----------

  async getDashboard(): Promise<DashboardSummary> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      activeProjects,
      delayedProjects,
      overduePayments,
      monthlyRevenue,
      monthlyCosts,
      totalCashCollected,
      pendingCollections,
      recentProjects,
      recentPayments,
    ] = await Promise.all([
      this.repo.countActiveProjects(),
      this.repo.countDelayedProjects(now),
      this.repo.countOverduePayments(now),
      this.repo.sumPaidPaymentsInRange(monthStart, now),
      this.repo.sumCostsInRange(monthStart, now),
      this.repo.sumPaidPaymentsTotal(),
      this.repo.sumOutstandingPaymentsTotal(),
      this.repo.recentProjects(RECENT_LIMIT),
      this.repo.recentPaidPayments(RECENT_LIMIT),
    ]);

    return {
      activeProjects,
      delayedProjects,
      overduePayments,
      monthlyRevenue: toMoneyString(monthlyRevenue),
      monthlyCosts: toMoneyString(monthlyCosts),
      monthlyProfit: toMoneyString(monthlyRevenue.minus(monthlyCosts)),
      totalCashCollected: toMoneyString(totalCashCollected),
      pendingCollections: toMoneyString(pendingCollections),
      recentProjects,
      recentPayments,
      asOf: now.toISOString(),
    };
  }

  // ---------- Project profitability ----------

  async listProjectProfitability(
    query: ListProjectProfitabilityQuery,
  ): Promise<Paginated<ProjectProfitability>> {
    const { skip, take } = toSkipTake(query);

    const [projects, total] = await Promise.all([
      this.repo.findProjectsForProfitability(
        { status: query.status, customerId: query.customerId },
        skip,
        take,
        query.sortBy,
        query.sortDir,
      ),
      this.repo.countProjectsForProfitability({
        status: query.status,
        customerId: query.customerId,
      }),
    ]);

    if (projects.length === 0) return buildPaginated([], total, query);

    const projectIds = projects.map((p) => p.id);
    const [costMap, paymentMap] = await Promise.all([
      this.repo.sumCostsByProject(projectIds),
      this.repo.sumPaidByProject(projectIds),
    ]);

    const items = projects.map((p: ProjectWithContractSummary) =>
      this.composeProfitability(
        p,
        costMap.get(p.id) ?? money(0),
        paymentMap.get(p.id) ?? money(0),
      ),
    );
    return buildPaginated(items, total, query);
  }

  async getProjectProfitability(projectId: string): Promise<ProjectProfitability> {
    const project = await this.repo.findProjectForProfitability(projectId);
    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

    const [costMap, paymentMap] = await Promise.all([
      this.repo.sumCostsByProject([projectId]),
      this.repo.sumPaidByProject([projectId]),
    ]);

    return this.composeProfitability(
      project as unknown as Parameters<ReportsService['composeProfitability']>[0],
      costMap.get(projectId) ?? money(0),
      paymentMap.get(projectId) ?? money(0),
    );
  }

  // ---------- Cash flow ----------

  async getCashFlow(query: CashFlowQuery): Promise<CashFlowReport> {
    const [totalRevenue, totalCollected, totalCosts] = await Promise.all([
      this.repo.sumApprovedContractValueInRange(query.dateFrom, query.dateTo),
      this.repo.sumPaidPaymentsInRange(query.dateFrom, query.dateTo),
      this.repo.sumCostsInRange(query.dateFrom, query.dateTo),
    ]);

    return {
      dateFrom: query.dateFrom?.toISOString() ?? null,
      dateTo: query.dateTo?.toISOString() ?? null,
      totalRevenue: toMoneyString(totalRevenue),
      totalCollected: toMoneyString(totalCollected),
      outstandingBalance: toMoneyString(totalRevenue.minus(totalCollected)),
      totalCosts: toMoneyString(totalCosts),
      netCashFlow: toMoneyString(totalCollected.minus(totalCosts)),
    };
  }

  // ---------- Overdue payments ----------

  async getOverduePayments(query: OverduePaymentsQuery): Promise<OverduePaymentsByProject[]> {
    const now = new Date();
    const payments = await this.repo.findOverduePayments(now, {
      customerId: query.customerId,
    });

    const grouped = new Map<string, OverduePaymentsByProject>();
    const totals = new Map<string, Money>();
    for (const p of payments) {
      let group = grouped.get(p.projectId);
      if (!group) {
        group = {
          projectId: p.projectId,
          projectName: p.project.name,
          contractId: p.project.contract?.id ?? null,
          contractNumber: p.project.contract?.contractNumber ?? null,
          customerId: p.project.contract?.customer.id ?? null,
          customerName: p.project.contract?.customer.name ?? null,
          totalOverdueAmount: '0.00',
          overduePaymentsCount: 0,
          oldestDueDate: p.dueDate,
          payments: [],
        };
        grouped.set(p.projectId, group);
        totals.set(p.projectId, money(0));
      }
      const daysOverdue = Math.floor((now.getTime() - p.dueDate.getTime()) / MS_PER_DAY);
      group.payments.push({
        id: p.id,
        amount: toMoneyString(p.amount),
        dueDate: p.dueDate,
        daysOverdue,
        reference: p.reference,
        method: p.method,
      });
      totals.set(p.projectId, totals.get(p.projectId)!.plus(money(p.amount)));
      group.overduePaymentsCount += 1;
      if (p.dueDate < group.oldestDueDate) group.oldestDueDate = p.dueDate;
    }

    for (const [projectId, group] of grouped) {
      group.totalOverdueAmount = toMoneyString(totals.get(projectId)!);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => a.oldestDueDate.getTime() - b.oldestDueDate.getTime(),
    );
  }

  // ---------- Delayed projects ----------

  async getDelayedProjects(query: DelayedProjectsQuery): Promise<DelayedProjectRow[]> {
    const now = new Date();
    const projects = await this.repo.findDelayedProjects(now, {
      customerId: query.customerId,
    });

    return projects.map((p) => ({
      projectId: p.id,
      name: p.name,
      status: p.status,
      contractId: p.contract?.id ?? null,
      contractNumber: p.contract?.contractNumber ?? null,
      customerId: p.contract?.customer.id ?? null,
      customerName: p.contract?.customer.name ?? null,
      startDate: p.startDate,
      deliveryDate: p.deliveryDate!,
      progressPercentage: Number(p.progressPercentage),
      daysDelayed: Math.floor((now.getTime() - p.deliveryDate!.getTime()) / MS_PER_DAY),
    }));
  }

  // ---------- Helpers ----------

  private composeProfitability(
    project: {
      id: string;
      name: string;
      status: import('@prisma/client').ProjectStatus;
      startDate: Date | null;
      deliveryDate: Date | null;
      progressPercentage: import('@prisma/client').Prisma.Decimal;
      contract: {
        id: string;
        contractNumber: string;
        totalPrice: import('@prisma/client').Prisma.Decimal;
        customer: { id: string; name: string };
      } | null;
    },
    totalCosts: Money,
    totalPaid: Money,
  ): ProjectProfitability {
    const contractValue = project.contract ? money(project.contract.totalPrice) : null;
    return {
      projectId: project.id,
      name: project.name,
      contractId: project.contract?.id ?? null,
      contractNumber: project.contract?.contractNumber ?? null,
      customerId: project.contract?.customer.id ?? null,
      customerName: project.contract?.customer.name ?? null,
      contractValue: toMoneyStringOrNull(contractValue),
      totalCosts: toMoneyString(totalCosts),
      totalPaid: toMoneyString(totalPaid),
      remainingBalance:
        contractValue !== null ? toMoneyString(contractValue.minus(totalPaid)) : null,
      profit: contractValue !== null ? toMoneyString(contractValue.minus(totalCosts)) : null,
      cashPosition: toMoneyString(totalPaid.minus(totalCosts)),
      progressPercentage: Number(project.progressPercentage),
      status: project.status,
      startDate: project.startDate,
      deliveryDate: project.deliveryDate,
    };
  }
}
