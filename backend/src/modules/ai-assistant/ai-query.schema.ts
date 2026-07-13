import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';

// ============================================================
// Phase 3 — the CLOSED constrained-query schema (NL → report).
//
// This file IS the whitelist: report types, and per-type filters/groupBy/
// sortBy, are enumerated exhaustively over reports that actually exist in
// modules/reports. The model never generates SQL/Prisma — only this shape —
// and ai-validation.service rejects anything outside it. The spec's example
// fixes the SHAPE ({reportType, filters, groupBy, sortBy}); the VALUES here
// are honest to the real ReportsService surface.
//
// Deliberately excluded from the model-facing whitelist:
//   - customerId filters (a language model cannot ground UUIDs from text —
//     it would only ever hallucinate them);
//   - pagination (fixed server-side).
// ============================================================

export const AI_QUERY_REPORT_TYPES = [
  'cash-flow',
  'delayed-projects',
  'overdue-payments',
  'project-profitability',
] as const;
export type AiQueryReportType = (typeof AI_QUERY_REPORT_TYPES)[number];

/** ISO calendar date (YYYY-MM-DD) → Date. Rejects anything unparsable. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid calendar date' });
      return z.NEVER;
    }
    return d;
  });

const sortDirSchema = z.enum(['asc', 'desc']);

// ----- one STRICT schema per report type (unknown keys are rejected) -----

// NOTE: union members must stay plain ZodObjects (no .refine) — zod's
// discriminatedUnion rejects ZodEffects. Cross-field semantics (dateFrom ≤
// dateTo) are enforced by ai-validation.service, the gate that owns them.
const cashFlowQuery = z
  .object({
    reportType: z.literal('cash-flow'),
    filters: z
      .object({
        dateFrom: isoDateSchema.optional(),
        dateTo: isoDateSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

const delayedProjectsQuery = z
  .object({
    reportType: z.literal('delayed-projects'),
    filters: z.object({}).strict().default({}),
    // 'project' is the report's inherent grouping — the only accepted value.
    groupBy: z.literal('project').optional(),
  })
  .strict();

const overduePaymentsQuery = z
  .object({
    reportType: z.literal('overdue-payments'),
    filters: z.object({}).strict().default({}),
    groupBy: z.literal('project').optional(),
  })
  .strict();

export const PROFITABILITY_SORT_FIELDS = ['createdAt', 'name', 'deliveryDate', 'startDate'] as const;

const projectProfitabilityQuery = z
  .object({
    reportType: z.literal('project-profitability'),
    filters: z
      .object({
        status: z.nativeEnum(ProjectStatus).optional(),
      })
      .strict()
      .default({}),
    groupBy: z.literal('project').optional(),
    sortBy: z.enum(PROFITABILITY_SORT_FIELDS).optional(),
    sortDir: sortDirSchema.optional(),
  })
  .strict();

/** The ONLY query shape that may ever reach ReportsService from the AI path. */
export const constrainedReportQuerySchema = z.discriminatedUnion('reportType', [
  cashFlowQuery,
  delayedProjectsQuery,
  overduePaymentsQuery,
  projectProfitabilityQuery,
]);
export type ConstrainedReportQuery = z.infer<typeof constrainedReportQuerySchema>;

/**
 * The model's output contract: EITHER a constrained query, OR an explicit
 * refusal for anything outside the four read-only reports (mutations,
 * unrelated questions). Free prose satisfies neither and is rejected.
 */
export const outOfScopeSchema = z
  .object({
    outOfScope: z.literal(true),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

// ----- endpoint body -----

export const nlQueryBodySchema = z.object({
  text: z.string().trim().min(3).max(500),
  // Optionally chain the Phase-2 narrative over the executed report.
  narrate: z.boolean().default(false),
});
export type NlQueryBody = z.infer<typeof nlQueryBodySchema>;
