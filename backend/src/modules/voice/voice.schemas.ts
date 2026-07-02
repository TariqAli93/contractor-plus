import { z } from 'zod';
import { uuidSchema } from '../../shared/validation/common.schemas.js';

export const interpretSchema = z.object({
  sessionId: uuidSchema.optional(),
  transcript: z.string().trim().min(1, 'النص فارغ').max(1000),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export const decisionSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  decision: z.enum(['confirm', 'cancel']),
});

export type InterpretInput = z.infer<typeof interpretSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;

// ----- Voice AI (LLM) settings -----

const providerSchema = z.enum(['anthropic', 'openai']);

export const updateVoiceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(100).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
  maxTokens: z.coerce.number().int().min(64).max(4000).optional(),
  // A new key to store (encrypted). Omit/empty = keep the existing one.
  apiKey: z.string().trim().max(400).optional(),
  clearApiKey: z.boolean().optional(),
});

export const testVoiceConnectionSchema = z.object({
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(100).optional(),
  apiKey: z.string().trim().max(400).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
});

export type UpdateVoiceSettingsInput = z.infer<typeof updateVoiceSettingsSchema>;
export type TestVoiceConnectionInput = z.infer<typeof testVoiceConnectionSchema>;
