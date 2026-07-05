import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { Paginated } from '@/types/pagination';
import type {
  ChangeOrder,
  ChangeOrderSummary,
  CreateChangeOrderInput,
  UpdateChangeOrderInput,
} from '@/types/changeOrder';

export const changeOrdersApi = {
  listForContract: (contractId: string): Promise<Paginated<ChangeOrder>> =>
    apiGet(`/contracts/${contractId}/change-orders`, {
      params: { pageSize: 100, sortBy: 'number', sortDir: 'asc' },
    }),

  summary: (contractId: string): Promise<ChangeOrderSummary> =>
    apiGet(`/contracts/${contractId}/change-order-summary`),

  create: (input: CreateChangeOrderInput): Promise<ChangeOrder> =>
    apiPost('/change-orders', input),

  update: (id: string, input: UpdateChangeOrderInput): Promise<ChangeOrder> =>
    apiPatch(`/change-orders/${id}`, input),

  approve: (id: string): Promise<ChangeOrder> => apiPost(`/change-orders/${id}/approve`),

  reject: (id: string): Promise<ChangeOrder> => apiPost(`/change-orders/${id}/reject`),

  remove: (id: string): Promise<void> => apiDelete(`/change-orders/${id}`),
};
