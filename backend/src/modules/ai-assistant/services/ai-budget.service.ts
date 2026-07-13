import { AppError } from '../../../shared/errors/app-error.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiMonthlyUsage } from '../ai-assistant.types.js';

// Phase 6 — monthly token-budget governance. Every provider call is already
// summarised into AiRequestLog with its usage; this service reads that back to
// (a) enforce the AI_MONTHLY_TOKEN_BUDGET ceiling before a new call, and
// (b) surface consumption in the settings page. No budget configured →
// unlimited, and the ceiling never blocks the LLM-free flows (material sync).

export class AiBudgetService {
  constructor(
    private readonly repo: AiAssistantRepository,
    /** Configured ceiling; undefined → unlimited. */
    private readonly monthlyBudget?: number,
  ) {}

  /** Current-calendar-month usage (UTC), with the configured ceiling applied. */
  async getMonthlyUsage(): Promise<AiMonthlyUsage> {
    const periodStart = currentMonthStart();
    const [totals, byOperation] = await Promise.all([
      this.repo.sumTokensSince(periodStart),
      this.repo.usageByOperationSince(periodStart),
    ]);
    const totalTokens = totals.prompt + totals.completion;
    const budget = this.monthlyBudget ?? null;
    const remaining = budget === null ? null : Math.max(0, budget - totalTokens);
    return {
      periodStart: periodStart.toISOString(),
      promptTokens: totals.prompt,
      completionTokens: totals.completion,
      totalTokens,
      requestCount: totals.count,
      budget,
      remaining,
      overBudget: budget !== null && totalTokens >= budget,
      byOperation: byOperation.sort((a, b) => b.tokens - a.tokens),
    };
  }

  /** True once the month's tokens reach the ceiling. False when unlimited. */
  async isOverBudget(): Promise<boolean> {
    if (this.monthlyBudget === undefined) return false;
    const totals = await this.repo.sumTokensSince(currentMonthStart());
    return totals.prompt + totals.completion >= this.monthlyBudget;
  }

  /**
   * Gate an explicit, model-calling request. Throws AI_BUDGET_EXCEEDED (429)
   * when the month's ceiling is reached — a clear stop for non-critical
   * operations (narratives, NL queries). The advisory flows (guards,
   * recommendation enrichment) call {@link isOverBudget} and skip instead, so
   * they never surface an error.
   */
  async assertWithinBudget(): Promise<void> {
    if (await this.isOverBudget()) {
      throw new AppError(
        429,
        'AI_BUDGET_EXCEEDED',
        'تجاوز الاستهلاك سقف الرموز الشهري للذكاء الاصطناعي — الطلبات غير الحرجة موقوفة حتى بداية الشهر القادم.',
      );
    }
  }
}

/** First instant of the current calendar month in UTC. */
function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
