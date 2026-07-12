import { z } from 'zod';
import {
  cashFlowQuerySchema,
  delayedProjectsQuerySchema,
  listProjectProfitabilityQuerySchema,
  overduePaymentsQuerySchema,
} from '../reports/reports.schemas.js';

// Validation schemas for the ai-assistant endpoints (same zod library as the
// rest of the modules). Phase 3 adds ai-query.schema.ts (the closed NL→report
// whitelist); Phase 4 adds guard/recommendation payloads.

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
