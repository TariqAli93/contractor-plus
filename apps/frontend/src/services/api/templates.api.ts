import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  BuildingTemplate,
  CreateTemplateInput,
  CreateTemplateItemInput,
  CreateTemplateStepInput,
  ListTemplatesQuery,
  TemplateEstimate,
  TemplateItem,
  TemplateStep,
  TemplateWithRelations,
  UpdateTemplateInput,
  UpdateTemplateItemInput,
  UpdateTemplateStepInput,
} from '@/types/template';
import type { Paginated } from '@/types/pagination';

export const templatesApi = {
  // ----- Top-level -----
  list: (query: ListTemplatesQuery): Promise<Paginated<BuildingTemplate>> =>
    apiGet('/templates', { params: query }),

  get: (id: string): Promise<TemplateWithRelations> => apiGet(`/templates/${id}`),

  create: (input: CreateTemplateInput): Promise<BuildingTemplate> =>
    apiPost('/templates', input),

  update: (id: string, input: UpdateTemplateInput): Promise<BuildingTemplate> =>
    apiPatch(`/templates/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/templates/${id}`),

  // ----- Items -----
  createItem: (templateId: string, input: CreateTemplateItemInput): Promise<TemplateItem> =>
    apiPost(`/templates/${templateId}/items`, input),

  updateItem: (
    templateId: string,
    itemId: string,
    input: UpdateTemplateItemInput,
  ): Promise<TemplateItem> => apiPatch(`/templates/${templateId}/items/${itemId}`, input),

  removeItem: (templateId: string, itemId: string): Promise<void> =>
    apiDelete(`/templates/${templateId}/items/${itemId}`),

  // ----- Steps -----
  createStep: (templateId: string, input: CreateTemplateStepInput): Promise<TemplateStep> =>
    apiPost(`/templates/${templateId}/steps`, input),

  updateStep: (
    templateId: string,
    stepId: string,
    input: UpdateTemplateStepInput,
  ): Promise<TemplateStep> => apiPatch(`/templates/${templateId}/steps/${stepId}`, input),

  removeStep: (templateId: string, stepId: string): Promise<void> =>
    apiDelete(`/templates/${templateId}/steps/${stepId}`),

  // ----- Estimate -----
  getEstimate: (templateId: string): Promise<TemplateEstimate> =>
    apiGet(`/templates/${templateId}/estimate`),
};
