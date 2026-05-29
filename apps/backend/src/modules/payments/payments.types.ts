import type { Payment, PaymentStatus } from '@prisma/client';

export interface PaymentListArgs {
  search?: string;
  projectId?: string;
  status?: PaymentStatus;
  late?: boolean;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  skip: number;
  take: number;
  sortBy: 'dueDate' | 'amount' | 'createdAt' | 'paymentDate';
  sortDir: 'asc' | 'desc';
}

export interface PaymentFilter {
  search?: string;
  projectId?: string;
  status?: PaymentStatus;
  late?: boolean;
  dueDateFrom?: Date;
  dueDateTo?: Date;
}

export interface ProjectPaymentSummary {
  projectId: string;
  contractId: string | null;
  contractNumber: string | null;
  contractTotal: number | null;
  totalPaid: number;
  remainingBalance: number | null;
  collectionPercentage: number | null;
  pendingPayments: number;
  latePayments: number;
  paidPayments: number;
  cancelledPayments: number;
  latestPayments: Payment[];
}
