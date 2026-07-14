import { AI_FEATURES, type AiFeature } from '@contractor-plus/shared';
import { AppError } from '../../../shared/errors/app-error.js';
import { ValidationError } from '../../../shared/errors/validation.error.js';
import type { AppConfig, MaterialPriceSource } from '../../../config/app-config.js';
import type {
  AiRuntime,
  AiRuntimeConfig,
  AiRuntimeConfigResolver,
  AiDisabledReason,
} from '../../../lib/ai/ai-config.js';
import type { AiProvider } from '../../../lib/ai/ai-provider.interface.js';
import { OpenRouterProvider } from '../../../lib/ai/openrouter.provider.js';
import { createSecretCipher, lastFour, type SecretCipher } from '../../../lib/crypto/secret-cipher.js';
import { checkOpenRouterKey, type KeyCheckResult } from '../../../lib/ai/openrouter-key-check.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiModelsService } from './ai-models.service.js';
import type {
  AiKeyInfo,
  AiModelsResponse,
  AiMonthlyUsage,
  AiSettingsDto,
  KeySaveResult,
  UpdateAiSettingInput,
} from '../ai-assistant.types.js';

// The CENTRAL AI control point. Everything AI resolves through here:
//   - the API key: the encrypted DB key is PRIMARY; env/service.json is only an
//     optional migration fallback (so the app runs with NO key in .env);
//   - the master + per-feature switches (DB wins over env);
//   - the chosen models, validated against the LIVE OpenRouter catalogue for
//     the current key (there is no static allow-list);
//   - the budget and price sources.
// The raw key never leaves this service — no method returns it except the
// internal `getResolvedApiKey`, which no route exposes.

/** Public request shape for PUT /ai/settings (already zod-validated upstream). */
export interface UpdateSettingsRequest {
  systemEnabled?: boolean;
  features?: Partial<Record<AiFeature, boolean>>;
  monthlyTokenBudget?: number | null;
  materialPriceSources?: MaterialPriceSource[];
}

export interface AiSettingsServiceDeps {
  repo: AiAssistantRepository;
  audit: AuditService;
  env: AppConfig;
  models: AiModelsService;
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

  // ---------- resolution (internal) ----------

  /**
   * The effective OpenRouter key. The DB key is PRIMARY (decrypted); the env
   * key is only a fallback when no DB key exists (or a DB row can't be
   * decrypted). Returns null when neither exists. INTERNAL ONLY — never a route.
   */
  async getResolvedApiKey(): Promise<string | null> {
    if (this.cipher) {
      const cred = await this.deps.repo.findActiveCredential();
      if (cred) {
        try {
          return this.cipher.decrypt({
            ciphertext: cred.ciphertext,
            iv: cred.iv,
            authTag: cred.authTag,
          });
        } catch {
          // Tampered row or a rotated ENCRYPTION_KEY — fall back to env, never crash.
        }
      }
    }
    return this.deps.env.OPENROUTER_API_KEY ?? null;
  }

  /** Full runtime for the provider — DB-wins settings + resolved key. */
  async resolveRuntime(): Promise<AiRuntime> {
    if (!(await this.isSystemEnabled())) {
      return { enabled: false, reason: 'SYSTEM_DISABLED' };
    }
    const apiKey = await this.getResolvedApiKey();
    if (!apiKey) return { enabled: false, reason: 'NOT_CONFIGURED' };

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
   * A resolver bound to this service — the provider consults it on every call,
   * so a key/model change from the panel applies with NO restart.
   */
  private buildRuntimeResolver(): AiRuntimeConfigResolver {
    return {
      resolve: async () => {
        const rt = await this.resolveRuntime();
        if (!rt.enabled) throw new AppError(503, 'AI_DISABLED', disabledMessage(rt.reason));
        return rt.config;
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
    return { provider: new OpenRouterProvider(this.buildRuntimeResolver()), config: rt.config };
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
    return { provider: new OpenRouterProvider(this.buildRuntimeResolver()), config: rt.config };
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

  // ---------- live models (dynamic, from OpenRouter) ----------

  /**
   * The models available to the CURRENT key, straight from OpenRouter (cached).
   * Throws 409 AI_NOT_CONFIGURED when no key is set.
   */
  async getModels(opts: { refresh?: boolean } = {}): Promise<AiModelsResponse> {
    const key = await this.getResolvedApiKey();
    if (!key) throw new AppError(409, 'AI_NOT_CONFIGURED', 'لم يُضبط مفتاح OpenRouter بعد.');
    const result = await this.deps.models.list(key, opts);
    return { models: result.items, stale: result.stale };
  }

  /**
   * Persist the chosen models — but only after checking they EXIST in the live
   * list for the current key. A slug from the panel is never trusted. Heavy
   * falls back to default when omitted.
   */
  async updateModels(
    defaultModel: string,
    heavyModel: string | null | undefined,
    actor: AuditActor,
  ): Promise<void> {
    const key = await this.getResolvedApiKey();
    if (!key) throw new AppError(409, 'AI_NOT_CONFIGURED', 'لم يُضبط مفتاح OpenRouter بعد.');

    const { items } = await this.deps.models.list(key);
    const available = new Set(items.map((m) => m.id));
    if (!available.has(defaultModel)) {
      throw new ValidationError('default model is not available for the current key', {
        defaultModel: [`${defaultModel} is not available`],
      });
    }
    const heavy = heavyModel && heavyModel.length > 0 ? heavyModel : defaultModel;
    if (!available.has(heavy)) {
      throw new ValidationError('heavy model is not available for the current key', {
        heavyModel: [`${heavy} is not available`],
      });
    }

    await this.deps.repo.saveSettings({
      modelDefault: defaultModel,
      modelHeavy: heavy,
      updatedById: requireUserId(actor),
    });
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiSetting',
      entityId: 'default',
      newValues: { modelDefault: defaultModel, modelHeavy: heavy },
    });
  }

  /**
   * Best-effort capability guard: if the model is in the cached list and does
   * NOT support tools, refuse with a clear error rather than a vague provider
   * failure. Fails OPEN when the model/capabilities are unknown (uncached).
   */
  async assertModelSupportsTools(model: string): Promise<void> {
    const key = await this.getResolvedApiKey();
    if (!key) return;
    const caps = this.deps.models.capabilities(key, model);
    if (caps && !caps.supportsTools) {
      throw new AppError(
        422,
        'AI_MODEL_TOOLS_UNSUPPORTED',
        'النموذج المختار لا يدعم استدعاء الأدوات المطلوبة لهذه الميزة — اختر نموذجًا يدعمها.',
      );
    }
  }

  // ---------- public read ----------

  /** GET /ai/settings — everything the panel needs, NEVER the raw key. */
  async getPublicSettings(usage: AiMonthlyUsage): Promise<AiSettingsDto> {
    const s = await this.deps.repo.findSettings();
    const systemEnabled = s?.systemEnabled ?? true;
    const runtime = await this.resolveRuntime();
    const key = await this.getKeyInfo();

    return {
      provider: 'openrouter',
      configured: key.status !== 'unset',
      enabled: runtime.enabled,
      ...(runtime.enabled ? {} : { reason: runtime.reason }),
      systemEnabled,
      features: readFeatureFlags(s?.features),
      modelDefault: await this.getModelDefault(),
      modelHeavy: await this.getModelHeavy(),
      modelCount: key.modelCount ?? null,
      keyManagementEnabled: this.keyManagementEnabled,
      key,
      monthlyTokenBudget: (await this.getMonthlyTokenBudget()) ?? null,
      usage,
      sources: await this.getMaterialPriceSources(),
      syncIntervalHours: this.deps.env.AI_MATERIAL_PRICE_SYNC_INTERVAL_HOURS ?? null,
    };
  }

  private async getKeyInfo(): Promise<AiKeyInfo> {
    // DB key is primary — report it first.
    const cred = this.cipher ? await this.deps.repo.findActiveCredential() : null;
    if (cred) {
      return {
        status: 'set_db',
        lastFour: cred.lastFour,
        validatedAt: cred.validatedAt?.toISOString(),
        modelCount: cred.validatedModelCount ?? null,
        managedByEnv: false,
      };
    }
    // No DB key → the env fallback (if any) is what resolves.
    if (this.deps.env.OPENROUTER_API_KEY) {
      return {
        status: 'set_env',
        lastFour: lastFour(this.deps.env.OPENROUTER_API_KEY),
        modelCount: null,
        managedByEnv: true,
      };
    }
    return { status: 'unset', modelCount: null, managedByEnv: false };
  }

  // ---------- mutations (ai.manage-settings; audited; no secrets logged) ----------

  async updateSettings(input: UpdateSettingsRequest, actor: AuditActor): Promise<void> {
    const patch: UpdateAiSettingInput = { updatedById: requireUserId(actor) };
    if (input.systemEnabled !== undefined) patch.systemEnabled = input.systemEnabled;
    if (input.features !== undefined) {
      // Merge the partial toggle update onto the CURRENT stored flags so an
      // unspecified feature keeps its value (not reset to the default).
      const current = readFeatureFlags((await this.deps.repo.findSettings())?.features);
      patch.features = mergeFeatureFlags(input.features, current);
    }
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
        ...(input.monthlyTokenBudget !== undefined && { monthlyTokenBudget: input.monthlyTokenBudget }),
        ...(input.materialPriceSources !== undefined && {
          materialPriceSourceCount: input.materialPriceSources.length,
        }),
      },
    });
  }

  /**
   * Set/replace the DB OpenRouter key. The key is validated LIVE — first the
   * cheap credit-free /key check, then a real models fetch — and only stored
   * (encrypted) when BOTH succeed. A key that can't be confirmed is NEVER
   * stored. The raw key is never logged or audited — only its last 4 chars and
   * the model count. The models cache is dropped so the new key's list is used.
   */
  async setApiKey(rawKey: string, actor: AuditActor): Promise<KeySaveResult> {
    if (!this.cipher) {
      throw new AppError(
        503,
        'AI_KEY_MANAGEMENT_DISABLED',
        'إدارة المفتاح من القاعدة معطّلة — لم يُضبط ENCRYPTION_KEY في الخادم.',
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

    // Prove the key can actually list models before trusting it. Drop any prior
    // cache first so a stale list from an old key can't mask a failure.
    this.deps.models.invalidate();
    let modelCount: number;
    try {
      const result = await this.deps.models.list(rawKey, { refresh: true });
      modelCount = result.items.length;
    } catch {
      throw new AppError(
        422,
        'AI_KEY_UNVERIFIED',
        'تعذّر جلب قائمة الموديلات بهذا المفتاح — لم يُحفظ.',
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
      validatedModelCount: modelCount,
      createdById: requireUserId(actor),
    });
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiProviderCredential',
      entityId: 'default',
      // NEVER the key or ciphertext — only the masked tail, when validated, count.
      newValues: { keyLastFour: lastFour(rawKey), validatedAt: now.toISOString(), modelCount },
    });

    return { configured: true, maskedKey: `••••••${lastFour(rawKey)}`, modelCount };
  }

  async clearApiKey(actor: AuditActor): Promise<void> {
    await this.deps.repo.deleteCredential();
    this.deps.models.invalidate();
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
    case 'NOT_CONFIGURED':
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
