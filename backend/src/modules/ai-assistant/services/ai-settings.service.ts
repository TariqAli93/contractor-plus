import { AI_FEATURES, AI_MODEL_ALLOWLIST, isAllowedModel, type AiFeature } from '@contractor-plus/shared';
import { AppError } from '../../../shared/errors/app-error.js';
import { ValidationError } from '../../../shared/errors/validation.error.js';
import type { AppConfig, MaterialPriceSource } from '../../../config/app-config.js';
import type { AiRuntime, AiRuntimeConfig, AiDisabledReason } from '../../../lib/ai/ai-config.js';
import type { AiProvider } from '../../../lib/ai/ai-provider.interface.js';
import { OpenRouterProvider } from '../../../lib/ai/openrouter.provider.js';
import { createSecretCipher, lastFour, type SecretCipher } from '../../../lib/crypto/secret-cipher.js';
import { checkOpenRouterKey, type KeyCheckResult } from '../../../lib/ai/openrouter-key-check.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type {
  AiKeyInfo,
  AiMonthlyUsage,
  AiSettingsDto,
  UpdateAiSettingInput,
} from '../ai-assistant.types.js';

// Phase 2.5 — the CENTRAL AI control point. Everything AI resolves through
// here: the API key (env WINS over DB), the master + per-feature switches, the
// chosen models (DB wins over env, from an allow-list), the budget, and the
// price sources. The raw key never leaves this service — no method returns it
// except the internal `getResolvedApiKey`, which no route exposes.

/** Public request shape for PUT /ai/settings (already zod-validated upstream). */
export interface UpdateSettingsRequest {
  systemEnabled?: boolean;
  features?: Partial<Record<AiFeature, boolean>>;
  modelDefault?: string | null;
  modelHeavy?: string | null;
  monthlyTokenBudget?: number | null;
  materialPriceSources?: MaterialPriceSource[];
}

export interface AiSettingsServiceDeps {
  repo: AiAssistantRepository;
  audit: AuditService;
  env: AppConfig;
  /** Injectable for tests; defaults to the real OpenRouter /key check. */
  keyChecker?: (rawKey: string) => Promise<KeyCheckResult>;
}

export class AiSettingsService {
  private readonly cipher: SecretCipher | null;

  constructor(private readonly deps: AiSettingsServiceDeps) {
    // Absent/short ENCRYPTION_KEY → null → DB-key management safely disabled.
    this.cipher = createSecretCipher(deps.env.ENCRYPTION_KEY);
  }

  /** DB key storage is available only when ENCRYPTION_KEY is usable. */
  get keyManagementEnabled(): boolean {
    return this.cipher !== null;
  }

  /** True when the key comes from env/service.json — it always wins. */
  get keyManagedByEnv(): boolean {
    return Boolean(this.deps.env.OPENROUTER_API_KEY);
  }

  // ---------- resolution (internal) ----------

  /**
   * The effective OpenRouter key. env/service.json WINS (E3); otherwise the
   * decrypted DB key when key management is enabled. Returns null when neither
   * exists. INTERNAL ONLY — never surfaced by a route.
   */
  async getResolvedApiKey(): Promise<string | null> {
    if (this.deps.env.OPENROUTER_API_KEY) return this.deps.env.OPENROUTER_API_KEY;
    if (!this.cipher) return null;
    const cred = await this.deps.repo.findActiveCredential();
    if (!cred) return null;
    try {
      return this.cipher.decrypt({ ciphertext: cred.ciphertext, iv: cred.iv, authTag: cred.authTag });
    } catch {
      // Tampered row or wrong ENCRYPTION_KEY — treat as no key (never crash).
      return null;
    }
  }

  /** Full runtime for the provider — DB-wins settings + resolved key. */
  async resolveRuntime(): Promise<AiRuntime> {
    if (!(await this.isSystemEnabled())) {
      return { enabled: false, reason: 'SYSTEM_DISABLED' };
    }
    const apiKey = await this.getResolvedApiKey();
    if (!apiKey) return { enabled: false, reason: 'NO_API_KEY' };

    const modelDefault = await this.getModelDefault();
    if (!modelDefault) return { enabled: false, reason: 'NO_DEFAULT_MODEL' };

    const env = this.deps.env;
    return {
      enabled: true,
      config: {
        apiKey,
        baseUrl: env.OPENROUTER_BASE_URL,
        modelDefault,
        modelHeavy: (await this.getModelHeavy()) ?? modelDefault,
        appUrl: env.AI_APP_URL,
        appTitle: env.AI_APP_TITLE,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        monthlyTokenBudget: await this.getMonthlyTokenBudget(),
      },
    };
  }

  /**
   * Resolve a provider for an explicit, model-calling feature, OR throw a clean
   * error: 503 AI_DISABLED (system off / no key / no model) or 503
   * AI_FEATURE_DISABLED (this feature toggled off). The single door every
   * model-calling feature opens.
   */
  async requireProviderForFeature(
    feature: AiFeature,
  ): Promise<{ provider: AiProvider; config: AiRuntimeConfig }> {
    const rt = await this.resolveRuntime();
    if (!rt.enabled) throw new AppError(503, 'AI_DISABLED', disabledMessage(rt.reason));
    if (!(await this.isFeatureEnabled(feature))) {
      throw new AppError(
        503,
        'AI_FEATURE_DISABLED',
        'هذه الميزة معطّلة من إعدادات الذكاء الاصطناعي.',
      );
    }
    return { provider: new OpenRouterProvider(rt.config), config: rt.config };
  }

  /**
   * Advisory (fail-open) variant: returns a provider+config when the feature is
   * usable, else null. Guards/enrichment use this and simply skip the AI layer
   * when null — never surfacing an error.
   */
  async optionalProviderForFeature(
    feature: AiFeature,
  ): Promise<{ provider: AiProvider; config: AiRuntimeConfig } | null> {
    const rt = await this.resolveRuntime();
    if (!rt.enabled) return null;
    if (!(await this.isFeatureEnabled(feature))) return null;
    return { provider: new OpenRouterProvider(rt.config), config: rt.config };
  }

  // ---------- the central gate ----------

  async isSystemEnabled(): Promise<boolean> {
    const s = await this.deps.repo.findSettings();
    return s?.systemEnabled ?? true; // default ON when unconfigured
  }

  /** THE gate every AI feature passes through: master switch AND feature flag. */
  async isFeatureEnabled(feature: AiFeature): Promise<boolean> {
    const s = await this.deps.repo.findSettings();
    if (s && s.systemEnabled === false) return false;
    const flags = readFeatureFlags(s?.features);
    return flags[feature] !== false; // default ON
  }

  // ---------- resolved non-key settings (DB wins, env fallback) ----------

  async getModelDefault(): Promise<string | undefined> {
    const s = await this.deps.repo.findSettings();
    return s?.modelDefault ?? this.deps.env.AI_MODEL_DEFAULT;
  }

  async getModelHeavy(): Promise<string | undefined> {
    const s = await this.deps.repo.findSettings();
    return s?.modelHeavy ?? this.deps.env.AI_MODEL_HEAVY;
  }

  async getMonthlyTokenBudget(): Promise<number | undefined> {
    const s = await this.deps.repo.findSettings();
    return s?.monthlyTokenBudget ?? this.deps.env.AI_MONTHLY_TOKEN_BUDGET;
  }

  async getMaterialPriceSources(): Promise<MaterialPriceSource[]> {
    const s = await this.deps.repo.findSettings();
    const db = s?.materialPriceSources;
    if (Array.isArray(db)) return db as unknown as MaterialPriceSource[];
    return this.deps.env.AI_MATERIAL_PRICE_SOURCES;
  }

  // ---------- public read ----------

  /** GET /ai/settings — everything the panel needs, NEVER the raw key. */
  async getPublicSettings(usage: AiMonthlyUsage): Promise<AiSettingsDto> {
    const s = await this.deps.repo.findSettings();
    const systemEnabled = s?.systemEnabled ?? true;
    const runtime = await this.resolveRuntime();

    return {
      enabled: runtime.enabled,
      ...(runtime.enabled ? {} : { reason: runtime.reason }),
      systemEnabled,
      features: readFeatureFlags(s?.features),
      modelDefault: await this.getModelDefault(),
      modelHeavy: await this.getModelHeavy(),
      modelAllowlist: [...AI_MODEL_ALLOWLIST],
      keyManagementEnabled: this.keyManagementEnabled,
      key: await this.getKeyInfo(),
      monthlyTokenBudget: (await this.getMonthlyTokenBudget()) ?? null,
      usage,
      sources: await this.getMaterialPriceSources(),
      syncIntervalHours: this.deps.env.AI_MATERIAL_PRICE_SYNC_INTERVAL_HOURS ?? null,
    };
  }

  private async getKeyInfo(): Promise<AiKeyInfo> {
    if (this.keyManagedByEnv) {
      return {
        status: 'set_env',
        lastFour: lastFour(this.deps.env.OPENROUTER_API_KEY!),
        managedByEnv: true,
      };
    }
    const cred = this.cipher ? await this.deps.repo.findActiveCredential() : null;
    if (cred) {
      return {
        status: 'set_db',
        lastFour: cred.lastFour,
        validatedAt: cred.validatedAt?.toISOString(),
        managedByEnv: false,
      };
    }
    return { status: 'unset', managedByEnv: false };
  }

  // ---------- mutations (ai.manage-settings; audited; no secrets logged) ----------

  async updateSettings(input: UpdateSettingsRequest, actor: AuditActor): Promise<void> {
    // Model choices from the panel MUST be in the allow-list (E4). env-provided
    // models bypass this because they never come through here.
    for (const model of [input.modelDefault, input.modelHeavy]) {
      if (model && !isAllowedModel(model)) {
        throw new ValidationError('model is not in the allowed list', {
          model: [`${model} is not an allowed model`],
        });
      }
    }

    const patch: UpdateAiSettingInput = { updatedById: requireUserId(actor) };
    if (input.systemEnabled !== undefined) patch.systemEnabled = input.systemEnabled;
    if (input.features !== undefined) {
      // Merge the partial toggle update onto the CURRENT stored flags so an
      // unspecified feature keeps its value (not reset to the default).
      const current = readFeatureFlags((await this.deps.repo.findSettings())?.features);
      patch.features = mergeFeatureFlags(input.features, current);
    }
    if (input.modelDefault !== undefined) patch.modelDefault = input.modelDefault;
    if (input.modelHeavy !== undefined) patch.modelHeavy = input.modelHeavy;
    if (input.monthlyTokenBudget !== undefined) patch.monthlyTokenBudget = input.monthlyTokenBudget;
    if (input.materialPriceSources !== undefined) patch.materialPriceSources = input.materialPriceSources;

    await this.deps.repo.saveSettings(patch);
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiSetting',
      entityId: 'default',
      // Only non-sensitive fields — there is no secret in settings.
      newValues: {
        ...(input.systemEnabled !== undefined && { systemEnabled: input.systemEnabled }),
        ...(input.features !== undefined && { features: input.features }),
        ...(input.modelDefault !== undefined && { modelDefault: input.modelDefault }),
        ...(input.modelHeavy !== undefined && { modelHeavy: input.modelHeavy }),
        ...(input.monthlyTokenBudget !== undefined && { monthlyTokenBudget: input.monthlyTokenBudget }),
        ...(input.materialPriceSources !== undefined && {
          materialPriceSourceCount: input.materialPriceSources.length,
        }),
      },
    });
  }

  /**
   * Set/replace the DB OpenRouter key: validate LIVE against OpenRouter, then
   * encrypt and store. A key that fails validation is NEVER stored. The raw key
   * is never logged or audited — only its last 4 chars.
   */
  async setApiKey(rawKey: string, actor: AuditActor): Promise<void> {
    if (!this.cipher) {
      throw new AppError(
        503,
        'AI_KEY_MANAGEMENT_DISABLED',
        'إدارة المفتاح من القاعدة معطّلة — لم يُضبط ENCRYPTION_KEY في الخادم.',
      );
    }
    if (this.keyManagedByEnv) {
      throw new AppError(
        409,
        'AI_KEY_ENV_MANAGED',
        'المفتاح مُدار من إعدادات الخادم (env) ولا يمكن تغييره من اللوحة.',
      );
    }

    const check = await (this.deps.keyChecker ??
      ((k: string) => checkOpenRouterKey(k, { baseUrl: this.deps.env.OPENROUTER_BASE_URL })))(rawKey);
    if (!check.ok) {
      throw new AppError(
        422,
        check.reason === 'invalid' ? 'AI_KEY_INVALID' : 'AI_KEY_UNVERIFIED',
        check.reason === 'invalid'
          ? 'المفتاح غير صالح — رفضه OpenRouter.'
          : 'تعذّر التحقق من المفتاح لدى OpenRouter — لم يُحفظ.',
      );
    }

    const sealed = this.cipher.encrypt(rawKey);
    const now = new Date();
    await this.deps.repo.saveCredential({
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      lastFour: lastFour(rawKey),
      validatedAt: now,
      createdById: requireUserId(actor),
    });
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiProviderCredential',
      entityId: 'default',
      // NEVER the key or ciphertext — only the masked tail + when validated.
      newValues: { keyLastFour: lastFour(rawKey), validatedAt: now.toISOString() },
    });
  }

  async clearApiKey(actor: AuditActor): Promise<void> {
    await this.deps.repo.deleteCredential();
    await this.deps.audit.log(actor, {
      action: 'DELETE',
      entity: 'AiProviderCredential',
      entityId: 'default',
      newValues: { cleared: true },
    });
  }
}

// ---------- pure helpers ----------

/** Coerce the stored features Json into a full, defaulted flag record. */
function readFeatureFlags(raw: unknown): Record<AiFeature, boolean> {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flags = {} as Record<AiFeature, boolean>;
  for (const f of AI_FEATURES) flags[f] = stored[f] !== false; // default ON
  return flags;
}

/** Human message for a disabled runtime reason (used by the 503). */
function disabledMessage(reason: AiDisabledReason): string {
  switch (reason) {
    case 'SYSTEM_DISABLED':
      return 'الذكاء الاصطناعي معطّل من لوحة التحكم.';
    case 'NO_API_KEY':
      return 'لم يُضبط مفتاح OpenRouter.';
    case 'NO_DEFAULT_MODEL':
      return 'لم يُحدَّد النموذج الافتراضي.';
  }
}

/** Merge a partial toggle update onto the current flags so the stored Json is full. */
function mergeFeatureFlags(
  input: Partial<Record<AiFeature, boolean>>,
  current: Record<AiFeature, boolean>,
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const f of AI_FEATURES) flags[f] = input[f] !== undefined ? Boolean(input[f]) : current[f];
  return flags;
}
