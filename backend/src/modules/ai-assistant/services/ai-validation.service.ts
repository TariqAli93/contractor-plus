import { AppError } from '../../../shared/errors/app-error.js';
import {
  constrainedReportQuerySchema,
  outOfScopeSchema,
  type ConstrainedReportQuery,
} from '../ai-query.schema.js';

// Phase 3 — THE security gate of the NL→report path. Model output comes in as
// untrusted JSON; the ONLY thing that ever leaves is a fully-validated
// ConstrainedReportQuery. Everything else throws a clean, client-safe error:
//
//   AI_QUERY_OUT_OF_SCOPE (422) — the model explicitly refused (mutations,
//       unrelated questions). Expected behavior, not a failure.
//   AI_QUERY_REJECTED     (422) — anything outside the closed whitelist:
//       unknown keys (including __proto__ etc. — .strict() rejects every
//       unlisted own key JSON.parse can produce), unknown report types,
//       filters not allowed for the type, bad enum/date values, or broken
//       cross-field semantics.
//
// No report executes unless this gate returned. Dedicated tests live in
// test/ai/ai-validation.service.test.ts (spec: the most important barrier).

export class AiValidationService {
  validateQuery(raw: unknown): ConstrainedReportQuery {
    // 1. Explicit refusal contract — checked first so a refusal never
    //    surfaces as a confusing "invalid query" error.
    const refusal = outOfScopeSchema.safeParse(raw);
    if (refusal.success) {
      throw new AppError(
        422,
        'AI_QUERY_OUT_OF_SCOPE',
        'The request is outside the supported read-only reports',
        refusal.data.reason ? { reason: refusal.data.reason } : undefined,
      );
    }

    // 2. The closed whitelist. strict() everywhere: any unlisted key — top
    //    level or inside filters — fails the parse.
    const parsed = constrainedReportQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(
        422,
        'AI_QUERY_REJECTED',
        'AI query does not match the allowed report schema',
        { issues: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`) },
      );
    }
    const query = parsed.data;

    // 3. Cross-field semantics the union schema cannot express.
    if (query.reportType === 'cash-flow') {
      const { dateFrom, dateTo } = query.filters;
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new AppError(422, 'AI_QUERY_REJECTED', 'AI query has dateFrom after dateTo', {
          issues: ['filters.dateFrom: must not be after dateTo'],
        });
      }
    }
    if (query.reportType === 'project-profitability' && query.sortDir && !query.sortBy) {
      throw new AppError(422, 'AI_QUERY_REJECTED', 'sortDir requires sortBy', {
        issues: ['sortDir: requires sortBy'],
      });
    }

    return query;
  }
}
