import type { AiRequestLog, PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { resolveAiRuntime, type AiRuntime } from '../../lib/ai/ai-config.js';
import { OpenRouterProvider } from '../../lib/ai/openrouter.provider.js';
import type { AiProvider } from '../../lib/ai/ai-provider.interface.js';
import { AuditService } from '../audit/audit.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CostsService } from '../costs/costs.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ChangeOrdersService } from '../change-orders/change-orders.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { AiAssistantRepository } from './ai-assistant.repository.js';
import { AiContextService } from './services/ai-context.service.js';
import { AiReportService } from './services/ai-report.service.js';
import { AiRecommendationService } from './services/ai-recommendation.service.js';
import { AiMaterialPricesService } from './services/ai-material-prices.service.js';
import { AiValidationService } from './services/ai-validation.service.js';
import { AiBudgetService } from './services/ai-budget.service.js';
import type { AiSettingsDto, AiStatusDto, CreateAiRequestLogInput } from './ai-assistant.types.js';

// Facade of the ai-assistant module. Data access rules (non-negotiable):
//   - own tables only via AiAssistantRepository;
//   - other modules' data only via THEIR public services (ReportsService,
//     SettingsService, …);
//   - every provider call goes through lib/ai (OpenRouter exclusively) and is
//     summarised into AiRequestLog + the audit module.
export class AiAssistantService {
  private readonly repo: AiAssistantRepository;
  private readonly runtime: AiRuntime;

  readonly context: AiContextService;
  readonly reports: AiReportService;
  readonly recommendations: AiRecommendationService;
  readonly materialPrices: AiMaterialPricesService;
  readonly validation: AiValidationService;
  readonly budget: AiBudgetService;

  constructor(prisma: PrismaClient, runtime: AiRuntime = resolveAiRuntime(env)) {
    this.repo = new AiAssistantRepository(prisma);
    this.runtime = runtime;

    // OpenRouter is the ONLY provider; null exactly when AI is disabled.
    const provider: AiProvider | null = runtime.enabled
      ? new OpenRouterProvider(runtime.config)
      : null;

    const reportsService = new ReportsService(prisma);
    const settingsService = new SettingsService(prisma);
    const auditService = new AuditService(prisma);
    // Ceiling comes from config regardless of enabled state, so the settings
    // page shows the configured budget + historical usage even when disabled.
    this.budget = new AiBudgetService(this.repo, env.AI_MONTHLY_TOKEN_BUDGET);
    this.context = new AiContextService(reportsService, settingsService);
    this.validation = new AiValidationService();
    this.reports = new AiReportService({
      runtime,
      provider,
      context: this.context,
      repo: this.repo,
      audit: auditService,
      reports: reportsService,
      validation: this.validation,
      budget: this.budget,
    });
    this.recommendations = new AiRecommendationService({
      runtime,
      provider,
      repo: this.repo,
      audit: auditService,
      reports: reportsService,
      costs: new CostsService(prisma),
      payments: new PaymentsService(prisma),
      changeOrders: new ChangeOrdersService(prisma),
      settings: settingsService,
      budget: this.budget,
    });
    this.materialPrices = new AiMaterialPricesService({
      repo: this.repo,
      materials: new MaterialsService(prisma),
      audit: auditService,
      sources: env.AI_MATERIAL_PRICE_SOURCES,
    });
  }

  /**
   * Feature availability for the SPA. A missing OPENROUTER_API_KEY (or default
   * model slug) is a NORMAL state — the UI shows "معطّل", nothing breaks.
   */
  getStatus(): AiStatusDto {
    if (!this.runtime.enabled) {
      return { enabled: false, reason: this.runtime.reason };
    }
    const { modelDefault, modelHeavy, monthlyTokenBudget } = this.runtime.config;
    return { enabled: true, modelDefault, modelHeavy, monthlyTokenBudget };
  }

  /**
   * Phase 6 — the governance/settings view (ai.manage-settings). Reflects the
   * config-sourced settings READ-ONLY and adds live monthly usage. Model slugs
   * and source NAMES are not secrets; the API key and source URLs are never
   * included.
   */
  async getSettings(): Promise<AiSettingsDto> {
    const usage = await this.budget.getMonthlyUsage();
    const base: AiSettingsDto = {
      enabled: this.runtime.enabled,
      usage,
      sources: env.AI_MATERIAL_PRICE_SOURCES.map((s) => ({
        name: s.name,
        region: s.region ?? null,
      })),
      syncIntervalHours: env.AI_MATERIAL_PRICE_SYNC_INTERVAL_HOURS ?? null,
    };
    if (!this.runtime.enabled) return { ...base, reason: this.runtime.reason };
    return { ...base, modelDefault: this.runtime.config.modelDefault, modelHeavy: this.runtime.config.modelHeavy };
  }

  /**
   * Governance write-path — every provider call (all phases) records its
   * SUMMARY here right after completion. Content is never stored.
   */
  logRequest(input: CreateAiRequestLogInput): Promise<AiRequestLog> {
    return this.repo.createRequestLog(input);
  }
}
