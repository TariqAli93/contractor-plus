// ============================================================
// Zod schemas — HTTP request bodies + the LLM-output validator.
//
// The LLM's raw JSON is validated against a discriminated union BEFORE the
// registry ever sees it, so a malformed / hallucinated response degrades to a
// clean rejection instead of crashing the executor.
// ============================================================

import { z } from 'zod';
import type { JsonSchemaSpec } from '../../lib/llm/llm-client.js';

// ---------- Endpoint bodies ----------

export const interpretBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sessionId: z.string().uuid().optional(),
});

export const confirmBodySchema = z.object({ sessionId: z.string().uuid() });
export const cancelBodySchema = z.object({ sessionId: z.string().uuid() });
export const sessionParamSchema = z.object({ sessionId: z.string().uuid() });

export type InterpretBody = z.infer<typeof interpretBodySchema>;
export type ConfirmBody = z.infer<typeof confirmBodySchema>;
export type CancelBody = z.infer<typeof cancelBodySchema>;

// ---------- LLM output validation ----------

const stepSchema = z.object({
  action: z.string().trim().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

const workflowPlanSchema = z.object({
  kind: z.literal('workflow_plan'),
  intent: z.string().trim().min(1).default('unknown'),
  confidence: z.number().min(0).max(1).optional(),
  missingSlots: z.array(z.string()).optional(),
  steps: z.array(stepSchema).min(1),
  confirmationMessage: z.string().optional(),
});

const clarificationSchema = z.object({
  kind: z.literal('clarification'),
  intent: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  missingSlots: z.array(z.string()).optional(),
  question: z.string().trim().min(1),
});

const querySchema = z.object({
  kind: z.literal('query'),
  intent: z.string().trim().min(1).default('unknown'),
  confidence: z.number().min(0).max(1).optional(),
  steps: z.array(stepSchema).min(1),
});

const rejectedSchema = z.object({
  kind: z.literal('rejected'),
  reason: z.string().trim().min(1),
});

export const llmInterpretationSchema = z.discriminatedUnion('kind', [
  workflowPlanSchema,
  clarificationSchema,
  querySchema,
  rejectedSchema,
]);

/** JSON Schema handed to OpenRouter (`json_schema` mode) to guide the model toward
 *  the union above. A superset of all four variants: `kind` is the discriminator;
 *  the rest are optional. `strict: false` because `steps[].data` is an open-ended,
 *  per-action map (which strict structured-output mode forbids) — the real
 *  contract is enforced by `llmInterpretationSchema` (Zod) after parsing. */
export const LLM_INTERPRETATION_JSON_SCHEMA: JsonSchemaSpec = {
  name: 'command_interpretation',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['workflow_plan', 'clarification', 'query', 'rejected'] },
      intent: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      missingSlots: { type: 'array', items: { type: 'string' } },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['action'],
          properties: {
            action: { type: 'string' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
      confirmationMessage: { type: 'string' },
      question: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

// ---------- LLM settings endpoints (OpenRouter only — no provider field) ----------

// OpenRouter model ids are vendor-prefixed and case-sensitive (e.g.
// "openai/gpt-4o-mini"), so they are only length-bounded here — validity is
// enforced against the live model catalog.
export const updateLlmSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().trim().min(1).max(160).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxTokens: z.number().int().min(64).max(8000).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  clearApiKey: z.boolean().optional(),
});

export const testLlmSettingsSchema = z.object({
  model: z.string().trim().min(1).max(160).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

// ---------- Model discovery query (GET /models) ----------

const boolParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const modelsQuerySchema = z.object({
  input: z.string().trim().min(1).max(40).optional(),
  output: z.string().trim().min(1).max(40).optional(),
  tools: boolParam.optional(),
  minContext: z.coerce.number().int().min(0).max(10_000_000).optional(),
  maxPromptPrice: z.coerce.number().min(0).optional(),
  free: boolParam.optional(),
  search: z.string().trim().max(120).optional(),
});

export type UpdateLlmSettingsBody = z.infer<typeof updateLlmSettingsSchema>;
export type TestLlmSettingsBody = z.infer<typeof testLlmSettingsSchema>;
export type ModelsQuery = z.infer<typeof modelsQuerySchema>;
