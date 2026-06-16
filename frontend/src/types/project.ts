import type { ContractStatus, ProjectStatus } from './enums';

export interface ProjectContractSummary {
  id: string;
  contractNumber: string;
  totalPrice: string;
  status: ContractStatus;
  signedAt: string | null;
  customer: { id: string; name: string };
}

export interface Project {
  id: string;
  contractId: string | null;
  name: string;
  startDate: string | null;
  deliveryDate: string | null;
  progressPercentage: string;
  status: ProjectStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ProjectWithContract = Project & {
  contract: ProjectContractSummary | null;
};

// ----- Inputs -----

export interface CreateProjectInput {
  contractId?: string | null;
  name: string;
  startDate?: string | Date | null;
  deliveryDate?: string | Date | null;
  notes?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  startDate?: string | Date | null;
  deliveryDate?: string | Date | null;
  progressPercentage?: number;
  notes?: string | null;
}

export interface ListProjectsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProjectStatus;
  delayed?: boolean;
  contractId?: string;
  sortBy?: 'createdAt' | 'name' | 'deliveryDate' | 'startDate';
  sortDir?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

// ----- Action bodies -----

export interface CancelProjectBody {
  reason?: string;
}
