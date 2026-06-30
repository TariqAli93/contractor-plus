import type { CostCategory, Material, ProjectCost } from '@prisma/client';

export interface CostListArgs {
  search?: string;
  projectId?: string;
  category?: CostCategory;
  dateFrom?: Date;
  dateTo?: Date;
  skip: number;
  take: number;
  sortBy: 'date' | 'totalAmount' | 'createdAt';
  sortDir: 'asc' | 'desc';
}

export interface CostFilter {
  search?: string;
  projectId?: string;
  category?: CostCategory;
  dateFrom?: Date;
  dateTo?: Date;
}

export type CostWithMaterial = ProjectCost & {
  material: Pick<Material, 'id' | 'name' | 'unit'> | null;
};

export interface ProjectCostSummary {
  projectId: string;
  // Money values are serialized as fixed-precision strings (no float drift).
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
