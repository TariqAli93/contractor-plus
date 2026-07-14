import type { AiRequestLog, PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
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
import { AiSettingsService } from './services/ai-settings.service.js';
import type { AiSettingsDto, AiStatusDto, CreateAiRequestLogInput } from './ai-assistant.types.js';

// Facade of the ai-assistant module. Data access rules (non-negotiable):
//   - own tables only via AiAssistantRepository;
//   - other modules' data only via THEIR public services (ReportsService,
//     SettingsService, …);
//   - every provider call goes through lib/ai (OpenRouter exclusively) and is
//     summarised into AiRequestLog + the audit module.
//
// Phase 2.5 — AiSettingsService is the central control point: it resolves the
// API key (env WINS over the encrypted DB key), the master + per-feature
// switches, the chosen models, the budget, and the price sources. Every
// sub-service gates through it, so a config change takes effect immediately
// (nothing is frozen at construction time).
export class AiAssistantService {
  private readonly repo: AiAssistantRepository;

  readonly settings: AiSettingsService;
  readonly context: AiContextService;
  readonly reports: AiReportService;
  readonly recommendations: AiRecommendationService;
  readonly materialPrices: AiMaterialPricesService;
  readonly validation: AiValidationService;
  readonly budget: AiBudgetService;

  constructor(prisma: PrismaClient) {
    this.repo = new AiAssistantRepository(prisma);

    const reportsService = new ReportsService(prisma);
    const settingsService = new SettingsService(prisma);
    const auditService = new AuditService(prisma);

    this.settings = new AiSettingsService({ repo: this.repo, audit: auditService, env });
    // Budget resolves DB-wins-env each call, so a panel change takes effect.
    this.budget = new AiBudgetService(this.repo, () => this.settings.getMonthlyTokenBudget());
    this.context = new AiContextService(reportsService, settingsService);
    this.validation = new AiValidationService();

    this.reports = new AiReportService({
      settings: this.settings,
      context: this.context,
      repo: this.repo,
      audit: auditService,
      reports: reportsService,
      validation: this.validation,
      budget: this.budget,
    });
    this.recommendations = new AiRecommendationService({
      aiSettings: this.settings,
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
      resolveSources: () => this.settings.getMaterialPriceSources(),
    });
  }

  /**
   * Feature availability for the SPA. A disabled system, missing key, or
   * missing model is a NORMAL state — the UI shows "معطّل", nothing breaks.
   */
  async getStatus(): Promise<AiStatusDto> {
    const runtime = await this.settings.resolveRuntime();
    if (!runtime.enabled) return { enabled: false, reason: runtime.reason };
    const { modelDefault, modelHeavy, monthlyTokenBudget } = runtime.config;
    return { enabled: true, modelDefault, modelHeavy, monthlyTokenBudget };
  }

  /**
   * The control-panel view (ai.use to read). DB-backed toggles/models/budget +
   * live monthly usage + the key STATUS. The raw key is NEVER included.
   */
  async getSettings(): Promise<AiSettingsDto> {
    const usage = await this.budget.getMonthlyUsage();
    return this.settings.getPublicSettings(usage);
  }

  /**
   * Governance write-path — every provider call (all phases) records its
   * SUMMARY here right after completion. Content is never stored.
   */
  logRequest(input: CreateAiRequestLogInput): Promise<AiRequestLog> {
    return this.repo.createRequestLog(input);
  }
}
