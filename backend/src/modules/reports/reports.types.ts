import type {
  Contract,
  Customer,
  Payment,
  PaymentMethod,
  Project,
  ProjectStatus,
} from '@prisma/client';

// Money values are serialized as fixed-precision STRINGS on the wire to avoid
// any float precision loss; non-monetary values (counts, percentages, areas)
// stay numbers.

export interface DashboardSummary {
  activeProjects: number;
  delayedProjects: number;
  overduePayments: number;
  monthlyRevenue: string;
  monthlyCosts: string;
  monthlyProfit: string;
  totalCashCollected: string;
  pendingCollections: string;
  recentProjects: RecentProject[];
  recentPayments: Payment[];
  asOf: string;
}

export interface RecentProject extends Project {
  contract:
    | (Pick<Contract, 'id' | 'contractNumber' | 'totalPrice'> & {
        customer: Pick<Customer, 'id' | 'name'>;
      })
    | null;
}

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
  startDate: Date | null;
  deliveryDate: Date | null;
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
  totalOverdueAmount: string;
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
