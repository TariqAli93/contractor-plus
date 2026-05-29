import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  ApproveContractBody,
  CancelContractBody,
  Contract,
  ContractEstimate,
  ContractProjectSummary,
  ContractWithRelations,
  CreateContractInput,
  CreateProjectFromContractBody,
  ListContractsQuery,
  UpdateContractInput,
} from '@/types/contract';
import type { Paginated } from '@/types/pagination';

export const contractsApi = {
  list: (query: ListContractsQuery): Promise<Paginated<Contract>> =>
    apiGet('/contracts', { params: query }),

  get: (id: string): Promise<ContractWithRelations> => apiGet(`/contracts/${id}`),

  create: (input: CreateContractInput): Promise<Contract> => apiPost('/contracts', input),

  update: (id: string, input: UpdateContractInput): Promise<Contract> =>
    apiPatch(`/contracts/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/contracts/${id}`),

  generateEstimate: (id: string): Promise<ContractEstimate> =>
    apiPost(`/contracts/${id}/generate-estimate`),

  approve: (id: string, body: ApproveContractBody = {}): Promise<Contract> =>
    apiPost(`/contracts/${id}/approve`, body),

  cancel: (id: string, body: CancelContractBody = {}): Promise<Contract> =>
    apiPost(`/contracts/${id}/cancel`, body),

  createProject: (
    id: string,
    body: CreateProjectFromContractBody = {},
  ): Promise<ContractProjectSummary> => apiPost(`/contracts/${id}/create-project`, body),
};
