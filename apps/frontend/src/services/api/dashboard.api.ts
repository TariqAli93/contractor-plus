import { apiGet } from './client';
import type {
  DashboardSummary,
  DelayedProjectRow,
  OverduePaymentsGroup,
} from '@/types/dashboard';

// Dashboard talks directly to the reports module's read endpoints. When the
// full reports feature ships, this stays focused on the home dashboard's
// composition and the reports feature gets its own reports.api.ts.
export const dashboardApi = {
  getSummary: (): Promise<DashboardSummary> => apiGet('/reports/dashboard'),
  getDelayedProjects: (): Promise<DelayedProjectRow[]> => apiGet('/reports/delayed-projects'),
  getOverduePayments: (): Promise<OverduePaymentsGroup[]> => apiGet('/reports/overdue-payments'),
};
