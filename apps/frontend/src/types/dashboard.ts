import type { PaymentMethod, PaymentStatus, ProjectStatus } from './enums';

// Mirrors backend reports.types — RecentProject is a Project row with the
// contract + customer summary joined in.
export interface DashboardRecentProject {
  id: string;
  name: string;
  status: ProjectStatus;
  progressPercentage: string;
  startDate: string | null;
  deliveryDate: string | null;
  contractId: string | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string };
  } | null;
  createdAt: string;
  updatedAt: string;
}

// Backend returns bare Payment rows for recentPayments — no project join.
export interface DashboardRecentPayment {
  id: string;
  projectId: string;
  amount: string;
  paymentDate: string | null;
  dueDate: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
}

export interface DashboardSummary {
  activeProjects: number;
  delayedProjects: number;
  overduePayments: number;
  monthlyRevenue: number;
  monthlyCosts: number;
  monthlyProfit: number;
  totalCashCollected: number;
  pendingCollections: number;
  recentProjects: DashboardRecentProject[];
  recentPayments: DashboardRecentPayment[];
  asOf: string;
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

export interface OverduePaymentLine {
  id: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  reference: string | null;
  method: PaymentMethod | null;
}

export interface OverduePaymentsGroup {
  projectId: string;
  projectName: string;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  totalOverdueAmount: number;
  overduePaymentsCount: number;
  oldestDueDate: string;
  payments: OverduePaymentLine[];
}
