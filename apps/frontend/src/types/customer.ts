export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface ListCustomersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}
