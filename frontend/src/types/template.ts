export interface TemplateItem {
  id: string;
  templateId: string;
  materialId: string;
  material: { id: string; name: string; unit: string };
  quantityFormula: string;
  // Prisma Decimals arrive as strings; coerce only when populating an input.
  estimatedQuantity: string;
  estimatedPrice: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateStep {
  id: string;
  templateId: string;
  name: string;
  percentage: string;
  sortOrder: number;
  estimatedDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildingTemplate {
  id: string;
  name: string;
  description: string | null;
  estimatedDurationDays: number | null;
  suggestedProfitMargin: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type TemplateWithRelations = BuildingTemplate & {
  items: TemplateItem[];
  steps: TemplateStep[];
};

// ----- Top-level template inputs -----

export interface CreateTemplateInput {
  name: string;
  description?: string | null;
  estimatedDurationDays?: number | null;
  suggestedProfitMargin?: number | null;
  isActive?: boolean;
}

export type UpdateTemplateInput = Partial<CreateTemplateInput>;

export interface ListTemplatesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: 'name' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

// ----- Item inputs -----

export interface CreateTemplateItemInput {
  materialId: string;
  // Legacy/internal - the backend auto-generates this from estimatedQuantity.
  // The UI no longer collects it.
  quantityFormula?: string;
  estimatedQuantity: number;
  estimatedPrice: number;
  notes?: string | null;
}

export type UpdateTemplateItemInput = Partial<CreateTemplateItemInput>;

// ----- Step inputs -----

export interface CreateTemplateStepInput {
  name: string;
  percentage: number;
  sortOrder: number;
  estimatedDays?: number | null;
}

export type UpdateTemplateStepInput = Partial<CreateTemplateStepInput>;

// ----- Estimate (read-only, backend-computed) -----

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
