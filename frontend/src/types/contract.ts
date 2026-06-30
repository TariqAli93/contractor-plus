import type { ContractStatus, ProjectStatus } from './enums';

export interface ContractItem {
  id: string;
  contractId: string;
  materialId: string;
  material: { id: string; name: string; unit: string };
  // Prisma Decimals serialize as strings; coerce only when populating an input.
  quantity: string;
  unit: string;
  estimatedPrice: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractCustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface ContractTemplateSummary {
  id: string;
  name: string;
}

export interface ContractProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  startDate: string | null;
  deliveryDate: string | null;
  progressPercentage: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  customerId: string;
  templateId: string | null;
  buildingArea: string;
  floors: number;
  meterPrice: string;
  totalPrice: string;
  expectedProfitMargin: string | null;
  status: ContractStatus;
  signedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ContractWithRelations = Contract & {
  customer: ContractCustomerSummary;
  template: ContractTemplateSummary | null;
  items: ContractItem[];
  project: ContractProjectSummary | null;
};

// ----- Inputs -----

export interface CreateContractInput {
  contractNumber: string;
  customerId: string;
  templateId?: string | null;
  buildingArea: number;
  floors: number;
  meterPrice: number;
  expectedProfitMargin?: number | null;
  notes?: string | null;
}

export type UpdateContractInput = Partial<CreateContractInput>;

export interface ListContractsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ContractStatus;
  customerId?: string;
  sortBy?: 'createdAt' | 'contractNumber' | 'totalPrice';
  sortDir?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

// ----- Action bodies -----

export interface ApproveContractBody {
  signedAt?: string | Date;
}

export interface CancelContractBody {
  reason?: string;
}

export interface CreateProjectFromContractBody {
  name?: string;
  startDate?: string | Date;
  deliveryDate?: string | Date;
  notes?: string | null;
}

// ----- Estimate response (from POST /generate-estimate) -----

export interface ContractEstimate {
  contractId: string;
  contractNumber: string;
  templateId: string;
  templateName: string;
  buildingArea: number;
  floors: number;
  scaleFactor: number;
  estimatedMaterialCost: string;
  expectedProfitMargin: number | null;
  estimatedProfitAmount: string | null;
  suggestedSellingPrice: string | null;
  suggestedMeterPrice: string | null;
  currentTotalPrice: string;
  currentMeterPrice: string;
  itemsReplaced: number;
}
