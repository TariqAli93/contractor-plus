import type { ReportsService } from '../../reports/reports.service.js';
import type {
  CashFlowQuery,
  DelayedProjectsQuery,
  ListProjectProfitabilityQuery,
  OverduePaymentsQuery,
} from '../../reports/reports.schemas.js';
import type { ConstrainedReportQuery } from '../ai-query.schema.js';

// The SINGLE place a validated constrained report query is executed. Both the
// NL→query flow (Phase 3) and the chat tool (Phase 7) route through here, so
// there is exactly one mapping from the closed query schema to the reports
// module's public service — never SQL, never a mutation. The query MUST have
// already passed ai-validation.service before reaching this function.

/** Map the constrained query onto the reports module's own query shapes. */
export function toReportsQuery(
  query: ConstrainedReportQuery,
): CashFlowQuery | DelayedProjectsQuery | OverduePaymentsQuery | ListProjectProfitabilityQuery {
  switch (query.reportType) {
    case 'cash-flow':
      return { dateFrom: query.filters.dateFrom, dateTo: query.filters.dateTo };
    case 'delayed-projects':
      return {};
    case 'overdue-payments':
      return {};
    case 'project-profitability':
      return {
        page: 1,
        pageSize: 20,
        status: query.filters.status,
        sortBy: query.sortBy ?? 'createdAt',
        sortDir: query.sortDir ?? 'desc',
      };
  }
}

/** Execute a VALIDATED constrained query through the reports public service. */
export function executeConstrainedReportQuery(
  reports: ReportsService,
  query: ConstrainedReportQuery,
): Promise<unknown> {
  switch (query.reportType) {
    case 'cash-flow':
      return reports.getCashFlow(toReportsQuery(query) as CashFlowQuery);
    case 'delayed-projects':
      return reports.getDelayedProjects(toReportsQuery(query) as DelayedProjectsQuery);
    case 'overdue-payments':
      return reports.getOverduePayments(toReportsQuery(query) as OverduePaymentsQuery);
    case 'project-profitability':
      return reports.listProjectProfitability(
        toReportsQuery(query) as ListProjectProfitabilityQuery,
      );
  }
}
