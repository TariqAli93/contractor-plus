import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CreateMaterialInput,
  ListMaterialsQuery,
  Material,
  UpdateMaterialInput,
} from '@/types/material';
import type { Paginated } from '@/types/pagination';

export const materialsApi = {
  list: (query: ListMaterialsQuery): Promise<Paginated<Material>> =>
    apiGet('/materials', { params: query }),

  get: (id: string): Promise<Material> => apiGet(`/materials/${id}`),

  create: (input: CreateMaterialInput): Promise<Material> => apiPost('/materials', input),

  update: (id: string, input: UpdateMaterialInput): Promise<Material> =>
    apiPatch(`/materials/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/materials/${id}`),
};
