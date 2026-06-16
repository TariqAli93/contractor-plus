import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CancelPaymentBody,
  CreatePaymentInput,
  ListPaymentsQuery,
  MarkPaidBody,
  Payment,
  ProjectPaymentSummary,
  UpdatePaymentInput,
} from '@/types/payment';
import type { Paginated } from '@/types/pagination';

export const paymentsApi = {
  list: (query: ListPaymentsQuery = {}): Promise<Paginated<Payment>> =>
    apiGet('/payments', { params: query }),

  get: (id: string): Promise<Payment> => apiGet(`/payments/${id}`),

  create: (input: CreatePaymentInput): Promise<Payment> => apiPost('/payments', input),

  update: (id: string, input: UpdatePaymentInput): Promise<Payment> =>
    apiPatch(`/payments/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/payments/${id}`),

  markPaid: (id: string, body: MarkPaidBody): Promise<Payment> =>
    apiPost(`/payments/${id}/mark-paid`, body),

  cancel: (id: string, body: CancelPaymentBody = {}): Promise<Payment> =>
    apiPost(`/payments/${id}/cancel`, body),

  // ----- Project-scoped (existing) -----

  listForProject: (
    projectId: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<Paginated<Payment>> => apiGet(`/projects/${projectId}/payments`, { params }),

  getProjectSummary: (projectId: string): Promise<ProjectPaymentSummary> =>
    apiGet(`/projects/${projectId}/payment-summary`),
};
