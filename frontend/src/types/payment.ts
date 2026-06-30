import type { PaymentMethod, PaymentStatus } from './enums';

export interface Payment {
  id: string;
  projectId: string;
  amount: string;
  dueDate: string;
  paymentDate: string | null;
  status: PaymentStatus;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProjectPaymentSummary {
  projectId: string;
  contractId: string | null;
  contractNumber: string | null;
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

// ----- Inputs (mirror backend zod) -----

export interface CreatePaymentInput {
  projectId: string;
  amount: number;
  dueDate: string | Date;
  method?: PaymentMethod | null;
  reference?: string | null;
  notes?: string | null;
}

export type UpdatePaymentInput = Partial<Omit<CreatePaymentInput, 'projectId'>>;

export interface ListPaymentsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  projectId?: string;
  status?: PaymentStatus;
  late?: boolean;
  dueDateFrom?: string | Date;
  dueDateTo?: string | Date;
  sortBy?: 'dueDate' | 'amount' | 'createdAt' | 'paymentDate';
  sortDir?: 'asc' | 'desc';
}

export interface MarkPaidBody {
  paymentDate: string | Date;
  method?: PaymentMethod;
  reference?: string;
}

export interface CancelPaymentBody {
  reason?: string;
}
