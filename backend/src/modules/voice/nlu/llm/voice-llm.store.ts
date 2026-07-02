// ============================================================
// Voice LLM settings store — DB-backed, encrypted, env-fallback.
//
// End users configure the LLM from inside the app (Settings → AI → Voice
// Assistant); values persist in the generic `SystemSetting` table under a
// `voiceAi.*` prefix. The API key is stored ENCRYPTED (AES-256-GCM via
// lib/crypto) — never in plaintext, never returned to the client, never logged.
//
// Resolution precedence: DB value if set, else the `.env` value (dev only). So
// the end user never touches `.env`; `.env` remains a developer convenience.
// Changes take effect on the NEXT voice turn — no restart (VoiceService resolves
// per turn). LLM stays DISABLED until explicitly enabled with a usable key.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { AuditService, type AuditActor } from '../../../audit/audit.service.js';
import { decryptSecret, encryptSecret } from '../../../../lib/crypto.js';
import { toJsonValue } from '../../../../shared/utils/json.js';
import { createLlmClient } from './llm-client.js';
import { loadVoiceLlmConfig, type LlmProviderName, type VoiceLlmConfig } from './voice-llm.config.js';

const PREFIX = 'voiceAi.';
const KEY_ENC = `${PREFIX}apiKeyEnc`;

/** UI-safe projection — NEVER contains the API key. */
export interface VoiceLlmSettingsView {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  /** True when a key is configured (DB or dev env) — the key itself is never sent. */
  apiKeySet: boolean;
  /** Whether LLM would actually engage right now (enabled AND a key present). */
  effective: boolean;
}

export interface VoiceLlmSettingsUpdate {
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
  error?: string;
}

export class VoiceLlmStore {
  private readonly audit: AuditService;
  constructor(private readonly prisma: PrismaClient) {
    this.audit = new AuditService(prisma);
  }

  // ---------- engine-facing ----------

  /** Effective config for the engine (DB over env), with the key decrypted. */
  async resolve(): Promise<VoiceLlmConfig> {
    const env = loadVoiceLlmConfig();
    const m = await this.rawMap();

    const provider: LlmProviderName = m.provider === 'openai' ? 'openai' : m.provider === 'anthropic' ? 'anthropic' : env.provider;

    return {
      enabled: typeof m.enabled === 'boolean' ? m.enabled : env.enabled,
      provider,
      model: typeof m.model === 'string' && m.model ? m.model : env.model,
      apiKey: this.decryptedKey(m) ?? env.apiKey,
      timeoutMs: typeof m.timeoutMs === 'number' ? m.timeoutMs : env.timeoutMs,
      maxTokens: typeof m.maxTokens === 'number' ? m.maxTokens : env.maxTokens,
      minConfidence: env.minConfidence,
    };
  }

  // ---------- UI-facing ----------

  async view(): Promise<VoiceLlmSettingsView> {
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

  async update(input: VoiceLlmSettingsUpdate, actor: AuditActor): Promise<VoiceLlmSettingsView> {
    const before = await this.view();

    await this.prisma.$transaction(async (tx) => {
      const set = (key: string, value: unknown) =>
        tx.systemSetting.upsert({
          where: { key: `${PREFIX}${key}` },
          create: { key: `${PREFIX}${key}`, value: value as never },
          update: { value: value as never },
        });

      if (input.enabled !== undefined) await set('enabled', input.enabled);
      if (input.provider !== undefined) await set('provider', input.provider);
      if (input.model !== undefined) await set('model', input.model);
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
      entity: 'VoiceLlmSettings',
      entityId: 'voiceAi',
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
    maxTokens?: number;
  }): Promise<TestConnectionResult> {
    const stored = await this.resolve();
    const provider = input.provider ?? stored.provider;
    const model = input.model ?? stored.model;
    const apiKey = input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : stored.apiKey;

    if (!apiKey) {
      return { ok: false, provider, model, error: 'no_api_key' };
    }

    const client = createLlmClient({
      enabled: true,
      provider,
      model,
      apiKey,
      timeoutMs: input.timeoutMs ?? stored.timeoutMs,
      maxTokens: 16,
      minConfidence: stored.minConfidence,
    });
    if (!client) return { ok: false, provider, model, error: 'client_unavailable' };

    try {
      await client.complete({ system: 'Reply with OK.', user: 'ping' });
      return { ok: true, provider, model };
    } catch (err) {
      // err messages are status codes (e.g. anthropic_http_401) — never the key.
      return { ok: false, provider, model, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  // ---------- internals ----------

  private async rawMap(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: PREFIX } } });
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
