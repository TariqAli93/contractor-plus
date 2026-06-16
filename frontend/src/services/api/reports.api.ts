import { apiGet } from './client';
import type {
  CashFlowQuery,
  CashFlowReport,
  DelayedProjectRow,
  DelayedProjectsQuery,
  ListProjectProfitabilityQuery,
  OverduePaymentsByProject,
  OverduePaymentsQuery,
  ProjectProfitability,
} from '@/types/report';
import type { DashboardSummary } from '@/types/dashboard';
import type { Paginated } from '@/types/pagination';

export const reportsApi = {
  dashboard: (): Promise<DashboardSummary> => apiGet('/reports/dashboard'),

  listProjectProfitability: (
    query: ListProjectProfitabilityQuery = {},
  ): Promise<Paginated<ProjectProfitability>> =>
    apiGet('/reports/project-profitability', { params: query }),

  getProjectProfitability: (projectId: string): Promise<ProjectProfitability> =>
    apiGet(`/reports/project-profitability/${projectId}`),

  cashFlow: (query: CashFlowQuery = {}): Promise<CashFlowReport> =>
    apiGet('/reports/cash-flow', { params: query }),

  overduePayments: (
    query: OverduePaymentsQuery = {},
  ): Promise<OverduePaymentsByProject[]> =>
    apiGet('/reports/overdue-payments', { params: query }),

  delayedProjects: (
    query: DelayedProjectsQuery = {},
  ): Promise<DelayedProjectRow[]> =>
    apiGet('/reports/delayed-projects', { params: query }),
};
