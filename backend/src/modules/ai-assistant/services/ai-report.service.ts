import { AppError } from '../../../shared/errors/app-error.js';
import { UpstreamError } from '../../../shared/errors/upstream.error.js';
import type { AiMessage, AiProvider } from '../../../lib/ai/ai-provider.interface.js';
import type { AiRuntime } from '../../../lib/ai/ai-config.js';
import type { AuditActor, AuditService } from '../../audit/audit.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiContextService, ReportNarrativeContext } from './ai-context.service.js';
import {
  narrativeOutputSchema,
  type AiReportType,
  type NarrativeOutput,
} from '../ai-assistant.schemas.js';
import { buildCashFlowNarrativeMessages } from '../prompts/report-narrative.cash-flow.js';
import { buildDelayedProjectsNarrativeMessages } from '../prompts/report-narrative.delayed-projects.js';
import { buildOverduePaymentsNarrativeMessages } from '../prompts/report-narrative.overdue-payments.js';
import { buildProjectProfitabilityNarrativeMessages } from '../prompts/report-narrative.project-profitability.js';

// Phase 2 — narrative layer over modules/reports. Read-only: the ONLY writes
// are the governance rows (AiRequestLog + AuditLog summary).

const NARRATIVE_MAX_TOKENS = 1200;
const NARRATIVE_TEMPERATURE = 0.2;
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
}

export interface ReportNarrativeResult {
  reportType: AiReportType;
  narrative: string;
  factors: string[];
  modelUsed: string;
  generatedAt: string;
}

export class AiReportService {
  constructor(private readonly deps: AiReportServiceDeps) {}

  /**
   * Generate an Arabic narrative for one report, over EXACTLY the dataset the
   * numeric report returns for `query`. Logs a summary to AiRequestLog (+
   * audit) on success; provider failures surface as clean retryable errors
   * and never break the numeric report page.
   */
  async narrative(
    reportType: AiReportType,
    query: Parameters<AiContextService['buildReportContext']>[1],
    actor: AuditActor,
  ): Promise<ReportNarrativeResult> {
    const { runtime, provider } = this.deps;
    if (!runtime.enabled || !provider) {
      throw new AppError(
        503,
        'AI_DISABLED',
        'AI features are disabled — configure the OpenRouter key first',
      );
    }

    const context = await this.deps.context.buildReportContext(reportType, query);
    const messages = PROMPT_BUILDERS[reportType](context);

    const completion = await provider.complete({
      model: runtime.config.modelDefault,
      messages,
      responseFormat: 'json_object',
      temperature: NARRATIVE_TEMPERATURE,
      maxTokens: NARRATIVE_MAX_TOKENS,
    });

    const output = parseNarrativeOutput(completion.content);

    // Governance trail: summary row + audit entry — never the full texts.
    const log = await this.deps.repo.createRequestLog({
      userId: actor.userId,
      operationType: 'REPORT_NARRATIVE',
      modelUsed: completion.modelUsed,
      sourceModules: context.sourceModules,
      recordIds: context.recordIds,
      tokensPrompt: completion.usage.promptTokens,
      tokensCompletion: completion.usage.completionTokens,
      outputSummary: summarize(output.narrative),
    });
    await this.deps.audit.log(actor, {
      action: 'CREATE',
      entity: 'AiRequestLog',
      entityId: log.id,
      newValues: {
        operationType: 'REPORT_NARRATIVE',
        reportType,
        modelUsed: completion.modelUsed,
        tokensPrompt: completion.usage.promptTokens,
        tokensCompletion: completion.usage.completionTokens,
      },
    });

    return {
      reportType,
      narrative: output.narrative,
      factors: output.factors,
      modelUsed: completion.modelUsed,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Model output must satisfy the JSON contract — the zod schema is the real
 * gate. Extraction is TOLERANT first (models routinely wrap JSON in markdown
 * fences even in json_object mode, which OpenRouter cannot enforce for every
 * upstream), then STRICT: whatever is extracted must parse and validate.
 */
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

/** Strip markdown fences / surrounding chatter down to the outermost {...}. */
function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function summarize(narrative: string): string {
  return narrative.length <= OUTPUT_SUMMARY_LIMIT
    ? narrative
    : `${narrative.slice(0, OUTPUT_SUMMARY_LIMIT - 1)}…`;
}
