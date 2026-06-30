import type { ContractStatus } from '@prisma/client';

export interface ContractListArgs {
  search?: string;
  status?: ContractStatus;
  customerId?: string;
  includeDeleted?: boolean;
  skip: number;
  take: number;
  sortBy: 'createdAt' | 'contractNumber' | 'totalPrice';
  sortDir: 'asc' | 'desc';
}

export interface ContractFilter {
  search?: string;
  status?: ContractStatus;
  customerId?: string;
  includeDeleted?: boolean;
}

export interface EstimateItemLine {
  materialId: string;
  materialName: string;
  unit: string;
  templateQuantity: number;
  scaledQuantity: number;
  templatePrice: number;
  scaledPrice: number;
  notes: string | null;
}

export interface ContractEstimate {
  contractId: string;
  contractNumber: string;
  templateId: string;
  templateName: string;
  buildingArea: number;
  floors: number;
  scaleFactor: number;
  // Money values are serialized as fixed-precision strings (no float drift).
  estimatedMaterialCost: string;
  expectedProfitMargin: number | null;
  estimatedProfitAmount: string | null;
  suggestedSellingPrice: string | null;
  suggestedMeterPrice: string | null;
  currentTotalPrice: string;
  currentMeterPrice: string;
  itemsReplaced: number;
}
