import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CostWithMaterial,
  CreateCostInput,
  ListCostsQuery,
  ProjectCost,
  ProjectCostSummary,
  UpdateCostInput,
} from '@/types/cost';
import type { Paginated } from '@/types/pagination';

export const costsApi = {
  list: (query: ListCostsQuery = {}): Promise<Paginated<CostWithMaterial>> =>
    apiGet('/costs', { params: query }),

  get: (id: string): Promise<CostWithMaterial> => apiGet(`/costs/${id}`),

  create: (input: CreateCostInput): Promise<ProjectCost> => apiPost('/costs', input),

  update: (id: string, input: UpdateCostInput): Promise<ProjectCost> =>
    apiPatch(`/costs/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/costs/${id}`),

  // ----- Project-scoped (kept for the existing projects feature) -----

  listForProject: (
    projectId: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<Paginated<CostWithMaterial>> =>
    apiGet(`/projects/${projectId}/costs`, { params }),

  getProjectSummary: (projectId: string): Promise<ProjectCostSummary> =>
    apiGet(`/projects/${projectId}/cost-summary`),
};
