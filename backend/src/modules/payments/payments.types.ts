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
  // Money values are serialized as fixed-precision strings; the collection
  // percentage stays a number (it is a ratio, not a currency amount).
  contractTotal: string | null;
  totalPaid: string;
  remainingBalance: string | null;
  collectionPercentage: number | null;
  pendingPayments: number;
  latePayments: number;
  paidPayments: number;
  cancelledPayments: number;
  latestPayments: Payment[];
}
