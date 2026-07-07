import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  EstimationGenerateResult,
  EstimationDraftResult,
  EstimationClarificationResult,
  EstimationPreview,
  EstimationConfirmResponse,
  EstimationCancelResult,
  EstimationTemplateView,
  EstimationMaterialDecision,
  EstimationUpdateItemRequest,
} from '@contractor-plus/shared';
import type { Paginated } from '@/types/pagination';

/** List row for confirmed templates (matches the backend summary shape). */
export interface EstimationTemplateSummary {
  id: string;
  name: string;
  projectType: string | null;
  areaValue: string | null;
  areaUnit: string | null;
  estimatedTotal: string;
  createdAt: string;
}

export interface ListEstimationTemplatesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'estimatedTotal';
  sortDir?: 'asc' | 'desc';
}

const BASE = '/estimation-templates';

export const estimationTemplatesApi = {
  // ----- AI draft lifecycle -----
  generate: (command: string, draftId?: string): Promise<EstimationGenerateResult> =>
    apiPost(`${BASE}/drafts`, { command, draftId }),

  getDraft: (draftId: string): Promise<EstimationDraftResult | EstimationClarificationResult> =>
    apiGet(`${BASE}/drafts/${draftId}`),

  resolveMaterials: (
    draftId: string,
    decisions: EstimationMaterialDecision[],
  ): Promise<EstimationDraftResult> =>
    apiPost(`${BASE}/drafts/${draftId}/resolve-materials`, { decisions }),

  updateItem: (
    draftId: string,
    tempId: string,
    patch: EstimationUpdateItemRequest,
  ): Promise<EstimationDraftResult> =>
    apiPatch(`${BASE}/drafts/${draftId}/items/${tempId}`, patch),

  updateWaste: (draftId: string, wastePercentage: number): Promise<EstimationDraftResult> =>
    apiPatch(`${BASE}/drafts/${draftId}/waste-percentage`, { wastePercentage }),

  preview: (draftId: string): Promise<EstimationPreview> =>
    apiGet(`${BASE}/drafts/${draftId}/preview`),

  confirm: (draftId: string, templateName: string): Promise<EstimationConfirmResponse> =>
    apiPost(`${BASE}/drafts/${draftId}/confirm`, { templateName }),

  cancel: (draftId: string): Promise<EstimationCancelResult> =>
    apiPost(`${BASE}/drafts/${draftId}/cancel`, {}),

  // ----- confirmed templates -----
  list: (query: ListEstimationTemplatesQuery): Promise<Paginated<EstimationTemplateSummary>> =>
    apiGet(BASE, { params: query }),

  get: (id: string): Promise<EstimationTemplateView> => apiGet(`${BASE}/${id}`),

  update: (id: string, input: { name?: string; notes?: string | null }): Promise<EstimationTemplateView> =>
    apiPatch(`${BASE}/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`${BASE}/${id}`),
};
