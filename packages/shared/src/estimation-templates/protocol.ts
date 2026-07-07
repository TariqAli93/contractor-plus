// ============================================================
// AI Smart Estimation Template Builder — wire protocol shared between the SPA
// and the backend.
//
// The builder is a linear, durable-draft workflow (unlike ai-command-workflow's
// short in-memory turn): generate → (clarify) → resolve materials → preview →
// confirm. Every backend response is one of these shapes; the frontend renders
// by `kind`. All money/quantity values cross the wire as fixed-precision STRINGS
// (never JS numbers) — the backend does every calculation in Decimal.
// ============================================================

import type { CostCategory } from '../enums/cost-category.js';

// ---------- enum-ish unions (mirror the Prisma enums) ----------

export type EstimationDraftStatus =
  | 'DRAFT_GENERATED'
  | 'CLARIFICATION_NEEDED'
  | 'MATERIALS_PENDING'
  | 'READY_FOR_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export type EstimationMaterialResolutionStatus =
  | 'MATCHED'
  | 'PENDING_APPROVAL'
  | 'APPROVED_CREATE'
  | 'SKIPPED';

// ---------- a single draft line item (as the SPA sees it) ----------

export interface EstimationDraftItem {
  /** Stable within a draft; the id the SPA sends back on edits/decisions. */
  tempId: string;
  category: CostCategory;
  description: string;
  /** The catalog name the AI proposed; null for non-material lines (labor, …). */
  materialNameGuess: string | null;
  /** Resolved catalog id, or null until a MATCHED/APPROVED_CREATE item is saved. */
  materialId: string | null;
  resolutionStatus: EstimationMaterialResolutionStatus;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalAmount: string;
  sortOrder: number;
}

// ---------- /generate results ----------

/** The AI needs more info before it can build a draft. */
export interface EstimationClarificationResult {
  kind: 'clarification';
  draftId: string;
  status: 'CLARIFICATION_NEEDED';
  question: string;
  missingFields: string[];
  confidence: number;
}

/** A draft was generated (or refined). Ready for material resolution / preview. */
export interface EstimationDraftResult {
  kind: 'draft_ready';
  draftId: string;
  status: 'MATERIALS_PENDING' | 'READY_FOR_CONFIRMATION';
  templateName: string;
  projectType: string | null;
  constructionType: string | null;
  scopeOfWork: string | null;
  areaValue: string | null;
  areaUnit: string | null;
  wastePercentage: string;
  estimatedTotal: string;
  confidence: number;
  items: EstimationDraftItem[];
}

/** The command was outside the feature's scope, or the AI/LLM failed. */
export interface EstimationRejectedResult {
  kind: 'rejected';
  draftId: string | null;
  reason: string;
  message: string;
}

export type EstimationGenerateResult =
  | EstimationClarificationResult
  | EstimationDraftResult
  | EstimationRejectedResult;

// ---------- /preview ----------

/** The full pre-save preview: the draft plus the mandatory reviewer warning. */
export interface EstimationPreview extends Omit<EstimationDraftResult, 'kind'> {
  /** Server-supplied (never client-hardcoded) so it can't drift. */
  warning: string;
  /** Convenience buckets the preview UI groups by, derived from `items`. */
  existingMaterials: EstimationDraftItem[];
  missingMaterials: EstimationDraftItem[];
  willCreateMaterials: EstimationDraftItem[];
}

// ---------- /confirm ----------

export interface EstimationConfirmResult {
  kind: 'confirmed';
  draftId: string;
  templateId: string;
  message: string;
  createdMaterialIds: string[];
  estimatedTotal: string;
}

export type EstimationConfirmResponse = EstimationConfirmResult | EstimationRejectedResult;

// ---------- /cancel ----------

export interface EstimationCancelResult {
  kind: 'cancelled';
  draftId: string;
  message: string;
}

// ---------- confirmed-template read model ----------

export interface EstimationTemplateItemView {
  id: string;
  category: CostCategory;
  materialId: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalAmount: string;
  sortOrder: number;
  notes: string | null;
}

export interface EstimationTemplateView {
  id: string;
  name: string;
  projectType: string | null;
  constructionType: string | null;
  scopeOfWork: string | null;
  areaValue: string | null;
  areaUnit: string | null;
  wastePercentage: string;
  estimatedTotal: string;
  isPreliminary: boolean;
  notes: string | null;
  items: EstimationTemplateItemView[];
  createdAt: string;
  updatedAt: string;
}

// ---------- request bodies ----------

export interface EstimationGenerateRequest {
  command: string;
  /** Continue an existing draft: answer a clarification, or refine the items. */
  draftId?: string;
}

export type EstimationMaterialDecision =
  | { tempId: string; decision: 'approve_create'; unit?: string; defaultPrice?: number | string }
  | { tempId: string; decision: 'skip' };

export interface EstimationResolveMaterialsRequest {
  decisions: EstimationMaterialDecision[];
}

export interface EstimationUpdateItemRequest {
  quantity?: number | string;
  unitPrice?: number | string;
  description?: string;
  unit?: string;
}

export interface EstimationWastePercentageRequest {
  wastePercentage: number | string;
}

export interface EstimationConfirmRequest {
  templateName: string;
}
