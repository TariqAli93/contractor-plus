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
  totalCosts: number;
  costCount: number;
  materialCosts: number;
  laborCosts: number;
  machineryCosts: number;
  transportCosts: number;
  miscCosts: number;
  totalByCategory: Record<CostCategory, number>;
  latestCosts: CostWithMaterial[];
}
