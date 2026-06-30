import type { CostCategory } from './enums';

// Slim material reference embedded in CostWithMaterial. Keeping the local
// name (Material) would collide with the standalone Material type when
// imported in the same file; alias kept under a unique name.
export interface CostMaterialRef {
  id: string;
  name: string;
  unit: string;
}

/** @deprecated use CostMaterialRef. Kept for any existing imports. */
export type Material = CostMaterialRef;

export interface ProjectCost {
  id: string;
  projectId: string;
  category: CostCategory;
  materialId: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalAmount: string;
  date: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type CostWithMaterial = ProjectCost & {
  material: CostMaterialRef | null;
};

export interface ProjectCostSummary {
  projectId: string;
  totalCosts: string;
  costCount: number;
  materialCosts: string;
  laborCosts: string;
  machineryCosts: string;
  transportCosts: string;
  miscCosts: string;
  totalByCategory: Record<CostCategory, string>;
  latestCosts: CostWithMaterial[];
}

// ----- Inputs (mirror backend zod) -----

export interface CreateCostInput {
  projectId: string;
  category: CostCategory;
  materialId?: string | null;
  description: string;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  totalAmount?: number;
  date: string | Date;
  notes?: string | null;
}

export type UpdateCostInput = Partial<Omit<CreateCostInput, 'projectId'>>;

export interface ListCostsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  projectId?: string;
  category?: CostCategory;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  sortBy?: 'date' | 'totalAmount' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}
