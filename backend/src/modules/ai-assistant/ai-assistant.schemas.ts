import { z } from 'zod';
import {
  cashFlowQuerySchema,
  delayedProjectsQuerySchema,
  listProjectProfitabilityQuerySchema,
  overduePaymentsQuerySchema,
} from '../reports/reports.schemas.js';
import { createCostSchema } from '../costs/costs.schemas.js';
import { createPaymentSchema } from '../payments/payments.schemas.js';
import { uuidSchema } from '../../shared/validation/common.schemas.js';

// Validation schemas for the ai-assistant endpoints (same zod library as the
// rest of the modules). The closed NL→report whitelist lives in
// ai-query.schema.ts.

// ----- Phase 2: report narratives -----

export const AI_REPORT_TYPES = [
  'cash-flow',
  'delayed-projects',
  'overdue-payments',
  'project-profitability',
] as const;
export type AiReportType = (typeof AI_REPORT_TYPES)[number];

export const narrativeParamsSchema = z.object({
  reportType: z.enum(AI_REPORT_TYPES),
});

// Narrative body = EXACTLY the filters the numeric report accepts, so the
// interpretation always describes the same dataset the user is looking at.
export const narrativeBodySchemas = {
  'cash-flow': cashFlowQuerySchema,
  'delayed-projects': delayedProjectsQuerySchema,
  'overdue-payments': overduePaymentsQuerySchema,
  'project-profitability': listProjectProfitabilityQuerySchema,
} as const;

// The ONLY output shape accepted from the model (json_object mode). Anything
// else — prose, missing keys, oversized content — is rejected as a bad
// provider response, never surfaced raw to the client.
export const narrativeOutputSchema = z.object({
  narrative: z.string().trim().min(1).max(4000),
  factors: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
});
export type NarrativeOutput = z.infer<typeof narrativeOutputSchema>;

// ----- Phase 4: save-guards -----

// A guard receives EXACTLY what the save will send — the same create schemas
// the costs/payments endpoints validate with, so the advisory check and the
// real save always agree on the payload shape.
export const guardCostBodySchema = createCostSchema;
export const guardPaymentBodySchema = createPaymentSchema;

/** Model output contract of the AI guard layer (strict, tiny, advisory). */
export const guardAiOutputSchema = z.object({
  warnings: z
    .array(
      z
        .object({
          code: z.string().trim().min(1).max(40),
          severity: z.enum(['info', 'warning']),
          message: z.string().trim().min(1).max(240),
        })
        .strict(),
    )
    .max(3)
    .default([]),
});

// ----- Phase 4: recommendations & suggestions -----

/** Model output contract of the enrichment layer — ids join back locally. */
export const recommendationEnrichmentSchema = z.object({
  items: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(120),
          priority: z.number().int().min(1).max(5),
          advice: z.string().trim().min(1).max(400),
        })
        .strict(),
    )
    .max(20)
    .default([]),
});

export const suggestionIdParamSchema = z.object({ id: uuidSchema });

// ----- Phase 5: material reference prices -----

export const materialIdParamSchema = z.object({ materialId: uuidSchema });

// ----- Phase 2.5: control panel -----

const priceSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(2000),
  region: z.string().trim().min(1).max(60).optional(),
});

// PUT /ai/settings — a partial update; every field optional. Model slugs are
// re-checked against the allow-list in the service (env models bypass it).
export const updateSettingsBodySchema = z
  .object({
    systemEnabled: z.boolean().optional(),
    features: z.record(z.string(), z.boolean()).optional(),
    modelDefault: z.string().trim().min(1).max(120).nullable().optional(),
    modelHeavy: z.string().trim().min(1).max(120).nullable().optional(),
    monthlyTokenBudget: z.number().int().positive().nullable().optional(),
    materialPriceSources: z.array(priceSourceSchema).max(50).optional(),
  })
  .strict();

// PUT /ai/settings/api-key — the raw key. Never logged; validated + encrypted
// by the service before storage.
export const setApiKeyBodySchema = z.object({
  apiKey: z.string().trim().min(8).max(400),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

// ----- Phase 7: chat -----

export const chatSendBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  threadId: uuidSchema.nullish().transform((v) => v ?? null),
});

export const threadIdParamSchema = z.object({ threadId: uuidSchema });
