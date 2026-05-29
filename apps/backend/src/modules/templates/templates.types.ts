export interface TemplateListArgs {
  search?: string;
  isActive?: boolean;
  skip: number;
  take: number;
  sortBy: 'name' | 'createdAt';
  sortDir: 'asc' | 'desc';
}

export interface TemplateFilter {
  search?: string;
  isActive?: boolean;
}

export interface EstimateMaterialLine {
  itemId: string;
  materialId: string;
  materialName: string;
  unit: string;
  quantityFormula: string;
  estimatedQuantity: number;
  estimatedPrice: number;
  notes: string | null;
}

export interface EstimateStepLine {
  id: string;
  name: string;
  sortOrder: number;
  percentage: number;
  estimatedDays: number | null;
}

export interface TemplateEstimate {
  templateId: string;
  templateName: string;
  estimatedMaterialCost: number;
  estimatedDurationDays: number | null;
  suggestedProfitMargin: number | null;
  estimatedProfitAmount: number | null;
  estimatedSellingPrice: number | null;
  materials: EstimateMaterialLine[];
  steps: EstimateStepLine[];
  summary: {
    itemCount: number;
    stepCount: number;
    totalStepsPercentage: number;
    totalStepsEstimatedDays: number;
  };
}
