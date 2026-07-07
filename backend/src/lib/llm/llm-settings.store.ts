// ============================================================
// LLM settings store — DB-backed, encrypted, env-fallback.
//
// End users configure the LLM from inside the app (Settings → AI Command);
// values persist in the generic `SystemSetting` table under an `ai.*` prefix.
// The API key is stored ENCRYPTED (AES-256-GCM via lib/crypto) — never in
// plaintext, never returned to the client, never logged.
//
// Resolution precedence: DB value if set, else the `.env` value (dev only). So
// the end user never touches `.env`; `.env` remains a developer convenience.
// Changes take effect on the NEXT command turn — no restart (the service
// resolves per turn). LLM stays DISABLED until explicitly enabled with a key.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { AuditService, type AuditActor } from '../../modules/audit/audit.service.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { createLlmClient, LLMError } from './llm-client.js';
import {
  isValidModelForProvider,
  loadLlmConfig,
  normalizeModel,
  resolveBaseUrl,
  type LlmConfig,
  type LlmProviderName,
} from './llm.config.js';

const PREFIX = 'ai.';
const KEY_ENC = `${PREFIX}apiKeyEnc`;

/** UI-safe projection — NEVER contains the API key. */
export interface LlmSettingsView {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  /** True when a key is configured (DB or dev env) — the key itself is never sent. */
  apiKeySet: boolean;
  /** Whether the LLM would actually engage right now (enabled AND a key present). */
  effective: boolean;
}

export interface LlmSettingsUpdate {
  enabled?: boolean;
  provider?: LlmProviderName;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** A new key to store (encrypted). Omit/empty = keep existing. */
  apiKey?: string;
  /** Explicitly remove the stored key. */
  clearApiKey?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  provider: LlmProviderName;
  model: string;
  latencyMs?: number;
  error?: string;
}

export class LlmSettingsStore {
  private readonly audit: AuditService;
  constructor(private readonly prisma: PrismaClient) {
    this.audit = new AuditService(prisma);
  }

  // ---------- engine-facing ----------

  /** Effective config for the engine (DB over env), with the key decrypted. */
  async resolve(): Promise<LlmConfig> {
    const env = loadLlmConfig();
    const m = await this.rawMap();

    const provider: LlmProviderName =
      m.provider === 'openai' || m.provider === 'anthropic' || m.provider === 'groq'
        ? m.provider
        : env.provider;

    return {
      enabled: typeof m.enabled === 'boolean' ? m.enabled : env.enabled,
      provider,
      model: typeof m.model === 'string' && m.model ? m.model : env.model,
      baseUrl: resolveBaseUrl(provider),
      apiKey: this.decryptedKey(m) ?? env.apiKey,
      timeoutMs: typeof m.timeoutMs === 'number' ? m.timeoutMs : env.timeoutMs,
      maxTokens: typeof m.maxTokens === 'number' ? m.maxTokens : env.maxTokens,
    };
  }

  // ---------- UI-facing ----------

  async view(): Promise<LlmSettingsView> {
    const cfg = await this.resolve();
    return {
      enabled: cfg.enabled,
      provider: cfg.provider,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxTokens: cfg.maxTokens,
      apiKeySet: Boolean(cfg.apiKey),
      effective: cfg.enabled && Boolean(cfg.apiKey),
    };
  }

  async update(input: LlmSettingsUpdate, actor: AuditActor): Promise<LlmSettingsView> {
    const before = await this.view();

    // Normalize + validate the model against the EFFECTIVE provider (the one
    // being set in this call, else the current one) BEFORE persisting. OpenAI
    // ids are trimmed + lowercased ("GPT-5.5" → "gpt-5.5") and rejected if not a
    // plausible OpenAI model; Anthropic ids are only trimmed (case-sensitive).
    const provider = input.provider ?? before.provider;
    let normalizedModel: string | undefined;
    if (input.model !== undefined) {
      normalizedModel = normalizeModel(provider, input.model);
      if (!isValidModelForProvider(provider, normalizedModel)) {
        throw new ValidationError(
          'اسم موديل OpenAI غير صالح — يجب أن يكون بأحرف صغيرة ويبدأ بـ gpt- أو o أو chatgpt- (مثل gpt-4o-mini).',
          { model: ['invalid_openai_model'] },
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const set = (key: string, value: unknown) =>
        tx.systemSetting.upsert({
          where: { key: `${PREFIX}${key}` },
          create: { key: `${PREFIX}${key}`, value: value as never },
          update: { value: value as never },
        });

      if (input.enabled !== undefined) await set('enabled', input.enabled);
      if (input.provider !== undefined) await set('provider', input.provider);
      if (input.model !== undefined) await set('model', normalizedModel);
      if (input.timeoutMs !== undefined) await set('timeoutMs', input.timeoutMs);
      if (input.maxTokens !== undefined) await set('maxTokens', input.maxTokens);

      // Secret handling — encrypt new key, or clear it; never store plaintext.
      if (input.clearApiKey) {
        await tx.systemSetting.deleteMany({ where: { key: KEY_ENC } });
      } else if (input.apiKey && input.apiKey.trim()) {
        await tx.systemSetting.upsert({
          where: { key: KEY_ENC },
          create: { key: KEY_ENC, value: encryptSecret(input.apiKey.trim()) },
          update: { value: encryptSecret(input.apiKey.trim()) },
        });
      }
    });

    const after = await this.view();
    // Audit the change — masked views only, the key never appears.
    await this.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiLlmSettings',
      entityId: 'ai',
      oldValues: toJsonValue(before),
      newValues: toJsonValue(after),
    });
    return after;
  }

  /** Test connectivity with the draft (or stored) config. Never reveals the key. */
  async testConnection(input: {
    provider?: LlmProviderName;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
  }): Promise<TestConnectionResult> {
    const stored = await this.resolve();
    const provider = input.provider ?? stored.provider;
    // Same normalization as the save path, so a draft "GPT-5.5" tests as "gpt-5.5".
    const model = normalizeModel(provider, input.model ?? stored.model);
    const apiKey = input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : stored.apiKey;

    if (!apiKey) {
      return { ok: false, provider, model, error: 'no_api_key' };
    }

    const client = createLlmClient({
      enabled: true,
      provider,
      model,
      baseUrl: resolveBaseUrl(provider),
      apiKey,
      timeoutMs: input.timeoutMs ?? stored.timeoutMs,
      maxTokens: 8,
    });
    if (!client) return { ok: false, provider, model, error: 'client_unavailable' };

    const startedAt = Date.now();
    try {
      await client.complete({ system: 'Return JSON only.', user: '{"ping":true}' });
      return { ok: true, provider, model, latencyMs: Date.now() - startedAt };
    } catch (err) {
      // Unified, key-safe code (e.g. rate_limited / model_not_found) — never the key.
      const code = err instanceof LLMError ? err.code : 'unknown_error';
      return { ok: false, provider, model, latencyMs: Date.now() - startedAt, error: code };
    }
  }

  // ---------- internals ----------

  private async rawMap(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: PREFIX } },
    });
    const map: Record<string, unknown> = {};
    for (const row of rows) map[row.key.slice(PREFIX.length)] = row.value;
    return map;
  }

  private decryptedKey(map: Record<string, unknown>): string | null {
    const enc = map.apiKeyEnc;
    if (typeof enc !== 'string' || !enc) return null;
    try {
      return decryptSecret(enc);
    } catch {
      return null; // unreadable (e.g. rotated app secret) → fall back to env/none
    }
  }
}
