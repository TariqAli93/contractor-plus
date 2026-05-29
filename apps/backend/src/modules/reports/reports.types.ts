import type {
  Contract,
  Customer,
  Payment,
  PaymentMethod,
  Project,
  ProjectStatus,
} from '@prisma/client';

export interface DashboardSummary {
  activeProjects: number;
  delayedProjects: number;
  overduePayments: number;
  monthlyRevenue: number;
  monthlyCosts: number;
  monthlyProfit: number;
  totalCashCollected: number;
  pendingCollections: number;
  recentProjects: RecentProject[];
  recentPayments: Payment[];
  asOf: string;
}

export interface RecentProject extends Project {
  contract:
    | (Pick<Contract, 'id' | 'contractNumber'> & { customer: Pick<Customer, 'id' | 'name'> })
    | null;
}

export interface ProjectProfitability {
  projectId: string;
  name: string;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  contractValue: number | null;
  totalCosts: number;
  totalPaid: number;
  remainingBalance: number | null;
  profit: number | null;
  cashPosition: number;
  progressPercentage: number;
  status: ProjectStatus;
  startDate: Date | null;
  deliveryDate: Date | null;
}

export interface CashFlowReport {
  dateFrom: string | null;
  dateTo: string | null;
  totalRevenue: number;
  totalCollected: number;
  outstandingBalance: number;
  totalCosts: number;
  netCashFlow: number;
}

export interface OverduePaymentRow {
  id: string;
  amount: number;
  dueDate: Date;
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
  totalOverdueAmount: number;
  overduePaymentsCount: number;
  oldestDueDate: Date;
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
  startDate: Date | null;
  deliveryDate: Date;
  progressPercentage: number;
  daysDelayed: number;
}
