import type { PaymentMethod, ProjectStatus } from './enums';

// Mirrors backend reports.types. Dates and money over JSON become string/number
// per Prisma's default JSON serializer (Decimal → string, Date → ISO string),
// so we keep both shapes loose where the backend does.

export interface ProjectProfitability {
  projectId: string;
  name: string;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  contractValue: string | null;
  totalCosts: string;
  totalPaid: string;
  remainingBalance: string | null;
  profit: string | null;
  cashPosition: string;
  progressPercentage: number;
  status: ProjectStatus;
  startDate: string | null;
  deliveryDate: string | null;
}

export interface CashFlowReport {
  dateFrom: string | null;
  dateTo: string | null;
  totalRevenue: string;
  totalCollected: string;
  outstandingBalance: string;
  totalCosts: string;
  netCashFlow: string;
}

export interface OverduePaymentRow {
  id: string;
  amount: string;
  dueDate: string;
  daysOverdue: number;
  reference: string | null;
  method: PaymentMethod | null;
}

export interface OverduePaymentsByProject {
  projectId: string;
  projectName: string;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  totalOverdueAmount: string;
  overduePaymentsCount: number;
  oldestDueDate: string;
  payments: OverduePaymentRow[];
}

export interface DelayedProjectRow {
  projectId: string;
  name: string;
  status: ProjectStatus;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  startDate: string | null;
  deliveryDate: string;
  progressPercentage: number;
  daysDelayed: number;
}

export interface ListProjectProfitabilityQuery {
  page?: number;
  pageSize?: number;
  status?: ProjectStatus;
  customerId?: string;
  sortBy?: 'createdAt' | 'name' | 'deliveryDate' | 'startDate';
  sortDir?: 'asc' | 'desc';
}

export interface CashFlowQuery {
  dateFrom?: string | Date;
  dateTo?: string | Date;
}

export interface OverduePaymentsQuery {
  customerId?: string;
}

export interface DelayedProjectsQuery {
  customerId?: string;
}
