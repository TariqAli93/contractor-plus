// ============================================================
// Zod schemas — HTTP request bodies + the LLM-output validator.
//
// The LLM's raw JSON is validated against a discriminated union BEFORE the
// registry ever sees it, so a malformed / hallucinated response degrades to a
// clean rejection instead of crashing the executor.
// ============================================================

import { z } from 'zod';

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

// ---------- LLM settings endpoints ----------

const providerSchema = z.enum(['openai', 'groq', 'anthropic', 'gemini', 'openrouter']);

export const updateLlmSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxTokens: z.number().int().min(64).max(8000).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  clearApiKey: z.boolean().optional(),
});

export const testLlmSettingsSchema = z.object({
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

export type UpdateLlmSettingsBody = z.infer<typeof updateLlmSettingsSchema>;
export type TestLlmSettingsBody = z.infer<typeof testLlmSettingsSchema>;
