import { AppError } from '../../../shared/errors/app-error.js';
import { UpstreamError } from '../../../shared/errors/upstream.error.js';
import { extractJsonObject } from '../../../lib/ai/extract-json.js';
import type {
  AiCompletionResult,
  AiMessage,
  AiProvider,
} from '../../../lib/ai/ai-provider.interface.js';
import type { AiRuntime, AiRuntimeConfig } from '../../../lib/ai/ai-config.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { ReportsService } from '../../reports/reports.service.js';
import type {
  CashFlowQuery,
  DelayedProjectsQuery,
  ListProjectProfitabilityQuery,
  OverduePaymentsQuery,
} from '../../reports/reports.schemas.js';
import type { AiRequestLog } from '@prisma/client';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiContextService, ReportNarrativeContext } from './ai-context.service.js';
import type { AiValidationService } from './ai-validation.service.js';
import {
  narrativeOutputSchema,
  type AiReportType,
  type NarrativeOutput,
} from '../ai-assistant.schemas.js';
import type { ConstrainedReportQuery } from '../ai-query.schema.js';
import { buildCashFlowNarrativeMessages } from '../prompts/report-narrative.cash-flow.js';
import { buildDelayedProjectsNarrativeMessages } from '../prompts/report-narrative.delayed-projects.js';
import { buildOverduePaymentsNarrativeMessages } from '../prompts/report-narrative.overdue-payments.js';
import { buildProjectProfitabilityNarrativeMessages } from '../prompts/report-narrative.project-profitability.js';
import { buildNlReportQueryMessages } from '../prompts/nl-report-query.js';

// Phase 2 — narrative layer over modules/reports. Phase 3 — constrained
// NL→query. Both are read-only: the ONLY writes are the governance rows
// (AiRequestLog + AuditLog summary), and — binding rule #4 — EVERY completed
// provider call is recorded, including ones whose output is later rejected.

const NARRATIVE_MAX_TOKENS = 1200;
const NARRATIVE_TEMPERATURE = 0.2;
const NL_QUERY_MAX_TOKENS = 400;
const NL_QUERY_TEMPERATURE = 0;
const OUTPUT_SUMMARY_LIMIT = 160;

const PROMPT_BUILDERS: Record<
  AiReportType,
  (context: ReportNarrativeContext) => AiMessage[]
> = {
  'cash-flow': buildCashFlowNarrativeMessages,
  'delayed-projects': buildDelayedProjectsNarrativeMessages,
  'overdue-payments': buildOverduePaymentsNarrativeMessages,
  'project-profitability': buildProjectProfitabilityNarrativeMessages,
};

export interface AiReportServiceDeps {
  runtime: AiRuntime;
  /** null exactly when runtime.enabled is false. */
  provider: AiProvider | null;
  context: AiContextService;
  repo: AiAssistantRepository;
  audit: AuditService;
  reports: ReportsService;
  validation: AiValidationService;
}

export interface ReportNarrativeResult {
  reportType: AiReportType;
  narrative: string;
  factors: string[];
  modelUsed: string;
  generatedAt: string;
}

export interface NlQueryResult {
  /** What the model understood — AFTER passing the validation gate. */
  query: ConstrainedReportQuery;
  /** The report's native payload, exactly as its GET endpoint returns it. */
  result: unknown;
  /** Present only when narrate=true and the optional narrative succeeded. */
  narrative?: ReportNarrativeResult;
  modelUsed: string;
}

export class AiReportService {
  constructor(private readonly deps: AiReportServiceDeps) {}

  /**
   * Phase 2 — generate an Arabic narrative for one report, over EXACTLY the
   * dataset the numeric report returns for `query`.
   */
  async narrative(
    reportType: AiReportType,
    query: Parameters<AiContextService['buildReportContext']>[1],
    actor: AuditActor,
  ): Promise<ReportNarrativeResult> {
    const { provider, config } = this.requireEnabled();

    const context = await this.deps.context.buildReportContext(reportType, query);
    const messages = PROMPT_BUILDERS[reportType](context);

    const completion = await provider.complete({
      model: config.modelDefault,
      messages,
      responseFormat: 'json_object',
      temperature: NARRATIVE_TEMPERATURE,
      maxTokens: NARRATIVE_MAX_TOKENS,
    });

    let output: NarrativeOutput;
    try {
      output = parseNarrativeOutput(completion.content);
    } catch (err) {
      // The call happened and cost tokens — it is recorded even when its
      // output is rejected. Never mask the primary failure with a log error.
      await this.safeLogGovernance(actor, {
        operationType: 'REPORT_NARRATIVE',
        completion,
        sourceModules: context.sourceModules,
        recordIds: context.recordIds,
        outputSummary: 'narrative rejected: bad model output',
        auditExtra: { reportType },
      });
      throw err;
    }

    await this.logGovernance(actor, {
      operationType: 'REPORT_NARRATIVE',
      completion,
      sourceModules: context.sourceModules,
      recordIds: context.recordIds,
      outputSummary: summarize(output.narrative),
      auditExtra: { reportType },
    });

    return {
      reportType,
      narrative: output.narrative,
      factors: output.factors,
      modelUsed: completion.modelUsed,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Phase 3 — NL text → constrained query → validation gate → ReportsService.
   * The model never sees the database; ai-validation.service is the ONLY door
   * to report execution, and out-of-scope requests stop there.
   */
  async queryFromText(text: string, narrate: boolean, actor: AuditActor): Promise<NlQueryResult> {
    const { provider, config } = this.requireEnabled();

    const completion = await provider.complete({
      model: config.modelDefault,
      messages: buildNlReportQueryMessages(text, todayIso()),
      responseFormat: 'json_object',
      temperature: NL_QUERY_TEMPERATURE,
      maxTokens: NL_QUERY_MAX_TOKENS,
    });

    let query: ConstrainedReportQuery;
    let result: unknown;
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(extractJsonObject(completion.content));
      } catch {
        throw new UpstreamError('AI returned non-JSON query output', 'AI_PROVIDER_BAD_RESPONSE');
      }
      // THE gate. Nothing executes unless this returns.
      query = this.deps.validation.validateQuery(raw);
      result = await this.executeQuery(query);
    } catch (err) {
      await this.safeLogGovernance(actor, {
        operationType: 'NL_REPORT_QUERY',
        completion,
        sourceModules: ['reports'],
        recordIds: [],
        outputSummary: `nl-query rejected: ${err instanceof AppError ? err.code : 'UNKNOWN'}`,
      });
      throw err;
    }

    await this.logGovernance(actor, {
      operationType: 'NL_REPORT_QUERY',
      completion,
      sourceModules: ['reports'],
      recordIds: [],
      outputSummary: summarize(`nl-query: ${describeQuery(query)}`),
      auditExtra: { reportType: query.reportType },
    });

    const nlResult: NlQueryResult = { query, result, modelUsed: completion.modelUsed };

    if (narrate) {
      // Optional Phase-2 add-on; its failure must not void the executed query.
      try {
        nlResult.narrative = await this.narrative(
          query.reportType,
          this.toReportsQuery(query),
          actor,
        );
      } catch {
        // Narrative leg failed (provider hiccup) — the query result stands.
      }
    }

    return nlResult;
  }

  // ---------- private ----------

  private requireEnabled(): { provider: AiProvider; config: AiRuntimeConfig } {
    const { runtime, provider } = this.deps;
    if (!runtime.enabled || !provider) {
      throw new AppError(
        503,
        'AI_DISABLED',
        'AI features are disabled — configure the OpenRouter key first',
      );
    }
    return { provider, config: runtime.config };
  }

  /** Execute a VALIDATED query through the reports module's public service. */
  private executeQuery(query: ConstrainedReportQuery): Promise<unknown> {
    switch (query.reportType) {
      case 'cash-flow':
        return this.deps.reports.getCashFlow(this.toReportsQuery(query) as CashFlowQuery);
      case 'delayed-projects':
        return this.deps.reports.getDelayedProjects(
          this.toReportsQuery(query) as DelayedProjectsQuery,
        );
      case 'overdue-payments':
        return this.deps.reports.getOverduePayments(
          this.toReportsQuery(query) as OverduePaymentsQuery,
        );
      case 'project-profitability':
        return this.deps.reports.listProjectProfitability(
          this.toReportsQuery(query) as ListProjectProfitabilityQuery,
        );
    }
  }

  /** Map the constrained query onto the reports module's own query shapes. */
  private toReportsQuery(
    query: ConstrainedReportQuery,
  ): CashFlowQuery | DelayedProjectsQuery | OverduePaymentsQuery | ListProjectProfitabilityQuery {
    switch (query.reportType) {
      case 'cash-flow':
        return { dateFrom: query.filters.dateFrom, dateTo: query.filters.dateTo };
      case 'delayed-projects':
        return {};
      case 'overdue-payments':
        return {};
      case 'project-profitability':
        return {
          page: 1,
          pageSize: 20,
          status: query.filters.status,
          sortBy: query.sortBy ?? 'createdAt',
          sortDir: query.sortDir ?? 'desc',
        };
    }
  }

  private async logGovernance(
    actor: AuditActor,
    input: {
      operationType: 'REPORT_NARRATIVE' | 'NL_REPORT_QUERY';
      completion: AiCompletionResult;
      sourceModules: string[];
      recordIds: string[];
      outputSummary: string;
      auditExtra?: Record<string, unknown>;
    },
  ): Promise<AiRequestLog> {
    const log = await this.deps.repo.createRequestLog({
      userId: requireUserId(actor),
      operationType: input.operationType,
      modelUsed: input.completion.modelUsed,
      sourceModules: input.sourceModules,
      recordIds: input.recordIds,
      tokensPrompt: input.completion.usage.promptTokens,
      tokensCompletion: input.completion.usage.completionTokens,
      outputSummary: input.outputSummary,
    });
    await this.deps.audit.log(actor, {
      action: 'CREATE',
      entity: 'AiRequestLog',
      entityId: log.id,
      newValues: {
        operationType: input.operationType,
        modelUsed: input.completion.modelUsed,
        tokensPrompt: input.completion.usage.promptTokens,
        tokensCompletion: input.completion.usage.completionTokens,
        outputSummary: input.outputSummary,
        ...(input.auditExtra ?? {}),
      },
    });
    return log;
  }

  /** Governance on a FAILURE path — must never mask the primary error. */
  private async safeLogGovernance(
    actor: AuditActor,
    input: Parameters<AiReportService['logGovernance']>[1],
  ): Promise<void> {
    try {
      await this.logGovernance(actor, input);
    } catch {
      // Swallowed by design: the caller is about to rethrow the real failure.
    }
  }
}

/** Model output must satisfy the JSON contract — the zod schema is the gate. */
function parseNarrativeOutput(raw: string): NarrativeOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new UpstreamError('AI returned non-JSON narrative output', 'AI_PROVIDER_BAD_RESPONSE');
  }
  const result = narrativeOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new UpstreamError(
      'AI narrative output failed schema validation',
      'AI_PROVIDER_BAD_RESPONSE',
    );
  }
  return result.data;
}

function summarize(text: string): string {
  return text.length <= OUTPUT_SUMMARY_LIMIT ? text : `${text.slice(0, OUTPUT_SUMMARY_LIMIT - 1)}…`;
}

/** Compact, content-free description of a validated query for the summary. */
function describeQuery(query: ConstrainedReportQuery): string {
  const parts: string[] = [query.reportType];
  const filters = Object.entries(query.filters as Record<string, unknown>)
    .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : String(v)}`)
    .join(',');
  if (filters) parts.push(filters);
  if ('sortBy' in query && query.sortBy) parts.push(`sort:${query.sortBy} ${query.sortDir ?? 'desc'}`);
  return parts.join(' ');
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
