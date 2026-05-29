import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CreateCustomerInput,
  Customer,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '@/types/customer';
import type { Paginated } from '@/types/pagination';

export const customersApi = {
  list: (query: ListCustomersQuery): Promise<Paginated<Customer>> =>
    apiGet('/customers', { params: query }),

  get: (id: string): Promise<Customer> => apiGet(`/customers/${id}`),

  create: (input: CreateCustomerInput): Promise<Customer> => apiPost('/customers', input),

  update: (id: string, input: UpdateCustomerInput): Promise<Customer> =>
    apiPatch(`/customers/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/customers/${id}`),
};
