// ============================================================
// Zod schemas — HTTP request bodies + the LLM-output validator.
//
// The LLM's raw JSON is validated against a discriminated union BEFORE anything
// downstream trusts it. Critically, the proposed-item shape is `.strict()` and
// declares NO `quantity`/`totalAmount`/`materialId` — so even a hallucinated
// quantity is rejected, not silently used. All final quantity/money math is the
// backend's job (estimation-templates.calc.ts).
// ============================================================

import { z } from 'zod';
import { CostCategory } from '@prisma/client';
import type { JsonSchemaSpec } from '../../lib/llm/llm-client.js';
import { paginationQuerySchema } from '../../shared/validation/common.schemas.js';

// ---------- endpoint bodies ----------

export const generateDraftBodySchema = z.object({
  command: z.string().trim().min(1).max(2000),
  /** Continue an existing draft (answer a clarification, or refine the items). */
  draftId: z.string().uuid().optional(),
});

const priceInput = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a number >= 0' });
      return z.NEVER;
    }
    return n;
  });

const quantityInput = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a number >= 0' });
      return z.NEVER;
    }
    return n;
  });

export const resolveMaterialsBodySchema = z.object({
  decisions: z
    .array(
      z.discriminatedUnion('decision', [
        z.object({
          tempId: z.string().min(1),
          decision: z.literal('approve_create'),
          unit: z.string().trim().min(1).max(50).optional(),
          defaultPrice: priceInput.optional(),
        }),
        z.object({
          tempId: z.string().min(1),
          decision: z.literal('skip'),
        }),
      ]),
    )
    .min(1),
});

/** Never accepts `totalAmount` — that is always server-recomputed. */
export const updateDraftItemBodySchema = z
  .object({
    quantity: quantityInput.optional(),
    unitPrice: priceInput.optional(),
    description: z.string().trim().min(1).max(300).optional(),
    unit: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const wastePercentageBodySchema = z.object({
  wastePercentage: z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      const n = typeof v === 'string' ? Number(v) : v;
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be between 0 and 100' });
        return z.NEVER;
      }
      return n;
    }),
});

export const confirmDraftBodySchema = z.object({
  templateName: z.string().trim().min(1).max(200),
});

export const draftIdParamSchema = z.object({ draftId: z.string().uuid() });
export const draftItemParamSchema = z.object({
  draftId: z.string().uuid(),
  tempId: z.string().min(1),
});

// ---------- confirmed-template CRUD ----------

export const listEstimationTemplatesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(['name', 'createdAt', 'estimatedTotal']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const updateEstimationTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

// ---------- LLM output validation ----------

/** A proposed item as the LLM emits it. `.strict()` so a smuggled `quantity`,
 *  `totalAmount`, or `materialId` is a hard rejection, not a silent accept. */
const llmProposedItemSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    category: z.nativeEnum(CostCategory),
    materialNameGuess: z.string().trim().min(1).max(200).nullable().default(null),
    ratioPerAreaUnit: z.number().nonnegative().nullable().default(null),
    // Approximate per-unit cost (or flat amount when ratio is null); a catalog
    // match overrides it. Allowed because a preliminary estimate needs prices
    // for non-catalog lines — but the backend still does all multiplication.
    unitPrice: z.number().nonnegative().nullable().default(null),
    unit: z.string().trim().min(1).max(50).nullable().default(null),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const llmDraftSchema = z.object({
  kind: z.literal('draft'),
  intent: z.object({
    projectType: z.string().trim().min(1).nullable().default(null),
    constructionType: z.string().trim().min(1).nullable().default(null),
    scopeOfWork: z.string().trim().min(1).nullable().default(null),
    templateName: z.string().trim().min(1).max(200).nullable().default(null),
    areaValue: z.number().positive().nullable().default(null),
    areaUnit: z.string().trim().min(1).max(20).nullable().default(null),
  }),
  wastePercentage: z.number().min(0).max(100).default(0),
  confidence: z.number().min(0).max(1).default(0.5),
  items: z.array(llmProposedItemSchema).min(1),
});

const llmClarificationSchema = z.object({
  kind: z.literal('clarification'),
  question: z.string().trim().min(1),
  missingFields: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const llmEstimationOutputSchema = z.discriminatedUnion('kind', [
  llmDraftSchema,
  llmClarificationSchema,
]);

/** JSON Schema handed to OpenRouter (`json_schema` mode) to guide the model toward
 *  the draft|clarification union above. Item objects are closed
 *  (`additionalProperties: false`) so a smuggled `quantity`/`totalAmount` is
 *  discouraged; `strict: false` overall because `intent` is an open map. The Zod
 *  `llmEstimationOutputSchema` remains the enforced contract after parsing. */
export const LLM_ESTIMATION_JSON_SCHEMA: JsonSchemaSpec = {
  name: 'estimation_output',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['draft', 'clarification'] },
      intent: { type: 'object', additionalProperties: true },
      wastePercentage: { type: 'number', minimum: 0, maximum: 100 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'category'],
          properties: {
            description: { type: 'string' },
            category: { type: 'string', enum: Object.values(CostCategory) },
            materialNameGuess: { type: ['string', 'null'] },
            ratioPerAreaUnit: { type: ['number', 'null'] },
            unitPrice: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
          },
        },
      },
      question: { type: 'string' },
      missingFields: { type: 'array', items: { type: 'string' } },
    },
  },
};

export type GenerateDraftBody = z.infer<typeof generateDraftBodySchema>;
export type ResolveMaterialsBody = z.infer<typeof resolveMaterialsBodySchema>;
export type UpdateDraftItemBody = z.infer<typeof updateDraftItemBodySchema>;
export type ConfirmDraftBody = z.infer<typeof confirmDraftBodySchema>;
export type ListEstimationTemplatesQuery = z.infer<typeof listEstimationTemplatesQuerySchema>;
export type UpdateEstimationTemplateBody = z.infer<typeof updateEstimationTemplateSchema>;
