import { formatMoney } from '../../../lib/docx/format-money.js';
import type { ReportsService } from '../../reports/reports.service.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type {
  CashFlowQuery,
  DelayedProjectsQuery,
  ListProjectProfitabilityQuery,
  OverduePaymentsQuery,
} from '../../reports/reports.schemas.js';
import type { AiReportType } from '../ai-assistant.schemas.js';

// Phase 2 — normalises ReportsService results into the SAFE DTO the prompt
// builders consume. Reads ONLY via the reports/settings public services.
//
// Safety rules applied here (binding rules #1/#4/#5):
//   - customer identifiers (name/id/phone) are STRIPPED — projects and
//     contract numbers are enough for a useful narrative;
//   - money is pre-formatted with the DEFAULT CURRENCY settings (same
//     formatter the DOCX renderer uses, mirroring the SPA), so the model can
//     only quote amounts verbatim, currency included;
//   - lists are capped and the DTO says so, so the model cannot extrapolate.

/** Max list rows fed to the model — keeps prompts small and focused. */
const ROW_LIMIT = 25;

export interface ReportNarrativeContext {
  reportType: AiReportType;
  /** e.g. "د.ع (IQD)" — every amount in `data` already carries it. */
  currencyLabel: string;
  data: Record<string, unknown>;
  sourceModules: string[];
  recordIds: string[];
}

type NarrativeQuery =
  | CashFlowQuery
  | DelayedProjectsQuery
  | OverduePaymentsQuery
  | ListProjectProfitabilityQuery;

export class AiContextService {
  constructor(
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
  ) {}

  async buildReportContext(
    reportType: AiReportType,
    query: NarrativeQuery,
  ): Promise<ReportNarrativeContext> {
    const currency = await this.settings.getDefaultCurrency();
    const fmt = (amount: string | number | null | undefined): string =>
      amount === null || amount === undefined ? '—' : formatMoney(amount, { currency });
    const currencyLabel = currency ? `${currency.symbol} (${currency.code})` : '';

    switch (reportType) {
      case 'cash-flow':
        return this.cashFlow(query as CashFlowQuery, fmt, currencyLabel);
      case 'delayed-projects':
        return this.delayedProjects(query as DelayedProjectsQuery, currencyLabel);
      case 'overdue-payments':
        return this.overduePayments(query as OverduePaymentsQuery, fmt, currencyLabel);
      case 'project-profitability':
        return this.projectProfitability(
          query as ListProjectProfitabilityQuery,
          fmt,
          currencyLabel,
        );
    }
  }

  private async cashFlow(
    query: CashFlowQuery,
    fmt: (v: string | null) => string,
    currencyLabel: string,
  ): Promise<ReportNarrativeContext> {
    const report = await this.reports.getCashFlow(query);
    return {
      reportType: 'cash-flow',
      currencyLabel,
      data: {
        period: { from: report.dateFrom ?? 'غير محدد', to: report.dateTo ?? 'غير محدد' },
        totalRevenue: fmt(report.totalRevenue),
        totalCollected: fmt(report.totalCollected),
        outstandingBalance: fmt(report.outstandingBalance),
        totalCosts: fmt(report.totalCosts),
        netCashFlow: fmt(report.netCashFlow),
      },
      sourceModules: ['reports'],
      recordIds: [],
    };
  }

  private async delayedProjects(
    query: DelayedProjectsQuery,
    currencyLabel: string,
  ): Promise<ReportNarrativeContext> {
    const rows = await this.reports.getDelayedProjects(query);
    const top = rows.slice(0, ROW_LIMIT);
    return {
      reportType: 'delayed-projects',
      currencyLabel,
      data: {
        totalCount: rows.length,
        truncated: rows.length > top.length,
        projects: top.map((r) => ({
          project: r.name,
          contractNumber: r.contractNumber,
          status: r.status,
          deliveryDate: isoDate(r.deliveryDate),
          daysDelayed: r.daysDelayed,
          progressPercentage: r.progressPercentage,
        })),
      },
      sourceModules: ['reports'],
      recordIds: top.map((r) => r.projectId),
    };
  }

  private async overduePayments(
    query: OverduePaymentsQuery,
    fmt: (v: string) => string,
    currencyLabel: string,
  ): Promise<ReportNarrativeContext> {
    const groups = await this.reports.getOverduePayments(query);
    const top = groups.slice(0, ROW_LIMIT);
    return {
      reportType: 'overdue-payments',
      currencyLabel,
      data: {
        totalCount: groups.length,
        truncated: groups.length > top.length,
        projects: top.map((g) => ({
          project: g.projectName,
          contractNumber: g.contractNumber,
          totalOverdueAmount: fmt(g.totalOverdueAmount),
          overduePaymentsCount: g.overduePaymentsCount,
          oldestDueDate: isoDate(g.oldestDueDate),
          maxDaysOverdue: g.payments.reduce((max, p) => Math.max(max, p.daysOverdue), 0),
        })),
      },
      sourceModules: ['reports'],
      recordIds: top.map((g) => g.projectId),
    };
  }

  private async projectProfitability(
    query: ListProjectProfitabilityQuery,
    fmt: (v: string | null) => string,
    currencyLabel: string,
  ): Promise<ReportNarrativeContext> {
    const page = await this.reports.listProjectProfitability(query);
    const top = page.items.slice(0, ROW_LIMIT);
    return {
      reportType: 'project-profitability',
      currencyLabel,
      data: {
        totalCount: page.total,
        truncated: page.total > top.length,
        projects: top.map((p) => ({
          project: p.name,
          contractNumber: p.contractNumber,
          status: p.status,
          contractValue: fmt(p.contractValue),
          totalCosts: fmt(p.totalCosts),
          totalPaid: fmt(p.totalPaid),
          profit: fmt(p.profit),
          cashPosition: fmt(p.cashPosition),
          progressPercentage: p.progressPercentage,
        })),
      },
      sourceModules: ['reports'],
      recordIds: top.map((p) => p.projectId),
    };
  }
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
