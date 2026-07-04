export type ChangeOrderStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';

export interface ChangeOrder {
  id: string;
  contractId: string;
  number: number;
  title: string;
  description: string | null;
  /** Signed money string (+addition / −deduction). */
  amount: string;
  status: ChangeOrderStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeOrderSummary {
  contractId: string;
  originalTotal: string;
  approvedDelta: string;
  revisedTotal: string;
  draftCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface CreateChangeOrderInput {
  contractId: string;
  title: string;
  description: string | null;
  amount: number;
}

export interface UpdateChangeOrderInput {
  title?: string;
  description?: string | null;
  amount?: number;
}
