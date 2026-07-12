import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { resolveAiRuntime, type AiRuntime } from '../../lib/ai/ai-config.js';
import { AiAssistantRepository } from './ai-assistant.repository.js';
import { AiContextService } from './services/ai-context.service.js';
import { AiReportService } from './services/ai-report.service.js';
import { AiRecommendationService } from './services/ai-recommendation.service.js';
import { AiMaterialPricesService } from './services/ai-material-prices.service.js';
import { AiValidationService } from './services/ai-validation.service.js';
import type { AiRequestLog } from '@prisma/client';
import type { AiStatusDto, CreateAiRequestLogInput } from './ai-assistant.types.js';

// Facade of the ai-assistant module. Data access rules (non-negotiable):
//   - own tables only via AiAssistantRepository;
//   - other modules' data only via THEIR public services (wired per phase);
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

  constructor(prisma: PrismaClient, runtime: AiRuntime = resolveAiRuntime(env)) {
    this.repo = new AiAssistantRepository(prisma);
    this.runtime = runtime;
    this.context = new AiContextService();
    this.reports = new AiReportService();
    this.recommendations = new AiRecommendationService();
    this.materialPrices = new AiMaterialPricesService();
    this.validation = new AiValidationService();
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
   * Governance write-path — every provider call (all phases) records its
   * SUMMARY here right after completion. Content is never stored.
   */
  logRequest(input: CreateAiRequestLogInput): Promise<AiRequestLog> {
    return this.repo.createRequestLog(input);
  }
}
