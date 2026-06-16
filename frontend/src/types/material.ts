export interface Material {
  id: string;
  name: string;
  unit: string;
  // Prisma Decimal serializes as string over JSON; we keep it as-is for display
  // and only coerce to a number when populating the form input.
  defaultPrice: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateMaterialInput {
  name: string;
  unit: string;
  defaultPrice?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

export type UpdateMaterialInput = Partial<CreateMaterialInput>;

export interface ListMaterialsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: 'name' | 'createdAt' | 'defaultPrice';
  sortDir?: 'asc' | 'desc';
}
