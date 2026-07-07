// ============================================================
// AI Smart Estimation Template Builder — shared internal types.
//
// The contract between the LLM interpretation layer, the deterministic calc
// layer, the repository, and the HTTP boundary. Like ai-command-workflow, the
// AI only PROPOSES (an intent + per-material ratios); the program computes,
// resolves, confirms, and executes. Money/quantity values are Decimal STRINGS in
// every persisted/serialized shape — the LLM never emits a final quantity.
// ============================================================

import type { CostCategory } from '@prisma/client';
import type { EstimationMaterialResolutionStatus } from '@contractor-plus/shared';

/** The authenticated caller + audit actor, threaded into every service method. */
export interface Principal {
  userId: string;
  role: string;
  actor: { userId: string; ipAddress?: string; userAgent?: string };
}

/** Caller context with the resolved effective permission set (OWNER → all). */
export interface EstimationContext extends Principal {
  permissions: Set<string>;
}

// ---------------------------------------------------------------------------
// Durable draft state (stored as JSON on EstimationTemplateDraft.generatedItems)
// ---------------------------------------------------------------------------

/** One line item inside a draft's `generatedItems` JSON blob. Money/quantity are
 *  Decimal strings; `ratioPerAreaUnit` is the LLM coefficient the backend
 *  multiplies by the parsed area (the LLM never emits `quantity` directly). */
export interface EstimationDraftItemPayload {
  tempId: string;
  category: CostCategory;
  description: string;
  materialNameGuess: string | null;
  /** LLM-supplied "N per area-unit" coefficient; null for non-scaled lines. */
  ratioPerAreaUnit: number | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalAmount: string;
  materialId: string | null;
  resolutionStatus: EstimationMaterialResolutionStatus;
  sortOrder: number;
  notes: string | null;
  /** Once a human edits quantity/price, the ratio is never re-applied to it. */
  userEdited: boolean;
}

/** The structured intent the LLM must extract (advisory fields are free text). */
export interface ParsedIntent {
  projectType: string | null;
  constructionType: string | null;
  scopeOfWork: string | null;
  templateName: string | null;
  areaValue: number | null;
  areaUnit: string | null;
  wastePercentage: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Raw LLM output — validated against a discriminated union before it is trusted
// (see estimation-templates.schemas.ts). Exactly one `kind`.
// ---------------------------------------------------------------------------

/** One proposed item as the LLM emits it — note: NO `quantity`/`totalAmount`
 *  (the schema rejects those; the backend derives them). The LLM MAY suggest an
 *  approximate `unitPrice` — legitimate for a preliminary estimate and required
 *  for non-catalog lines (labor/transport); a catalog match overrides it. The
 *  deterministic guarantee is about ARITHMETIC (quantity, totals, waste, sums),
 *  not about forbidding a suggested starting price. */
export interface LlmProposedItem {
  description: string;
  category: CostCategory;
  materialNameGuess: string | null;
  /** Quantity coefficient (× area). null → a flat/lump-sum line (no quantity). */
  ratioPerAreaUnit: number | null;
  /** Approximate per-unit cost, or the flat amount when ratio is null. */
  unitPrice: number | null;
  unit: string | null;
  notes: string | null;
}

export interface LlmEstimationDraft {
  kind: 'draft';
  intent: {
    projectType: string | null;
    constructionType: string | null;
    scopeOfWork: string | null;
    templateName: string | null;
    areaValue: number | null;
    areaUnit: string | null;
  };
  wastePercentage: number;
  confidence: number;
  items: LlmProposedItem[];
}

export interface LlmEstimationClarification {
  kind: 'clarification';
  question: string;
  missingFields: string[];
  confidence: number;
}

export type LlmEstimationOutput = LlmEstimationDraft | LlmEstimationClarification;

// ---------------------------------------------------------------------------
// Repository input shapes
// ---------------------------------------------------------------------------

export interface EstimationAuditLogInput {
  draftId: string;
  userId: string | null;
  eventType:
    | 'draft_generated'
    | 'draft_refined'
    | 'materials_resolved'
    | 'confirmed'
    | 'cancelled'
    | 'failed';
  originalCommand: string;
  parsedIntent?: unknown;
  generatedEstimation?: unknown;
  existingMaterialsUsed?: unknown;
  newlyCreatedMaterials?: unknown;
  userApproval?: unknown;
  executedActions?: unknown;
  finalSavedValues?: unknown;
  failedReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
