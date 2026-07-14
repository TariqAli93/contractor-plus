/**
 * Tests for the central AiSettingsService after the dynamic-models overhaul:
 * DB-first key resolution (env is only a fallback), the feature gate,
 * live-list model validation, validate-AND-fetch-models before storing a key,
 * and the guarantee that no method returns the raw key. Repo/audit/key-check
 * and the OpenRouter models fetch are all faked.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import type { AiModelListItem } from '@contractor-plus/shared';

import { AiSettingsService } from '../../src/modules/ai-assistant/services/ai-settings.service.js';
import { AiModelsService } from '../../src/modules/ai-assistant/services/ai-models.service.js';
import { SecretCipher } from '../../src/lib/crypto/secret-cipher.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { AppConfig } from '../../src/config/app-config.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { KeyCheckResult } from '../../src/lib/ai/openrouter-key-check.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { ValidationError } from '../../src/shared/errors/validation.error.js';

const ENC_KEY = randomBytes(32).toString('hex');
const ACTOR: AuditActor = { userId: 'user-1' };

function model(id: string, over: Partial<AiModelListItem> = {}): AiModelListItem {
  return {
    id,
    name: id,
    provider: id.split('/')[0]!,
    displayName: id,
    isFree: id.endsWith(':free'),
    contextLength: 128000,
    promptPricePerMillion: 1,
    completionPricePerMillion: 2,
    supportsTools: true,
    supportsStructuredOutput: true,
    ...over,
  };
}

const MODELS: AiModelListItem[] = [
  model('anthropic/claude-sonnet-4.6'),
  model('anthropic/claude-opus-4.8'),
  model('openai/gpt-5'),
  model('deepseek/deepseek-r1:free', { isFree: true, supportsTools: false }),
];

function baseEnv(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
    AI_MODEL_DEFAULT: 'anthropic/claude-sonnet-4.6',
    AI_REQUEST_TIMEOUT_MS: 5000,
    AI_MATERIAL_PRICE_SOURCES: [],
    ...overrides,
  } as AppConfig;
}

interface FakeCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  lastFour: string;
  validatedAt: Date | null;
  validatedModelCount?: number | null;
}

interface FakeState {
  settings: Record<string, unknown> | null;
  credential: FakeCredential | null;
}

function fakeRepo(state: FakeState) {
  return {
    findSettings: async () => state.settings,
    findActiveCredential: async () => state.credential,
    saveSettings: async (data: Record<string, unknown>) => {
      state.settings = { ...(state.settings ?? {}), ...data };
      return state.settings;
    },
    saveCredential: async (data: FakeCredential) => {
      state.credential = data;
      return data;
    },
    deleteCredential: async () => {
      state.credential = null;
    },
  } as unknown as AiAssistantRepository;
}

function fakeAudit() {
  const logged: Array<{ actor: AuditActor; input: AuditLogInput }> = [];
  const audit = {
    log: async (actor: AuditActor, input: AuditLogInput) => { logged.push({ actor, input }); },
  } as unknown as AuditService;
  return { audit, logged };
}

function make(opts: {
  env?: AppConfig;
  state?: Partial<FakeState>;
  keyChecker?: (k: string) => Promise<KeyCheckResult>;
  fetcher?: (rawKey: string) => Promise<AiModelListItem[]>;
} = {}) {
  const state: FakeState = {
    settings: opts.state?.settings ?? null,
    credential: opts.state?.credential ?? null,
  };
  const { audit, logged } = fakeAudit();
  const fetchCalls: string[] = [];
  const models = new AiModelsService({
    baseUrl: 'https://openrouter.test/api/v1',
    fetcher:
      opts.fetcher ??
      (async (rawKey) => {
        fetchCalls.push(rawKey);
        return MODELS;
      }),
  });
  const service = new AiSettingsService({
    repo: fakeRepo(state),
    audit,
    env: opts.env ?? baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    models,
    keyChecker: opts.keyChecker,
  });
  return { service, state, logged, models, fetchCalls };
}

function sealed(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  return new SecretCipher(ENC_KEY).encrypt(plaintext);
}

// ---------- key resolution: DB is PRIMARY, env is a fallback ----------

test('DB key WINS over the env fallback', async () => {
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-ENV-KEY' }),
    state: { credential: { ...sealed('sk-or-DB-KEY'), lastFour: 'YKEY', validatedAt: new Date() } },
  });
  assert.equal(await service.getResolvedApiKey(), 'sk-or-DB-KEY');
});

test('env key is used only as a fallback when no DB key exists', async () => {
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-ENV-KEY' }),
  });
  assert.equal(await service.getResolvedApiKey(), 'sk-or-ENV-KEY');
});

test('a tampered/undecryptable DB row falls back to the env key (never crashes)', async () => {
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-FALLBACK' }),
    state: { credential: { ciphertext: 'garbage', iv: 'garbage', authTag: 'garbage', lastFour: 'XXXX', validatedAt: null } },
  });
  assert.equal(await service.getResolvedApiKey(), 'sk-or-FALLBACK');
});

test('no key anywhere → NOT_CONFIGURED, boot never breaks', async () => {
  const { service } = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }) });
  const rt = await service.resolveRuntime();
  assert.equal(rt.enabled, false);
  if (!rt.enabled) assert.equal(rt.reason, 'NOT_CONFIGURED');
});

test('no ENCRYPTION_KEY → key management disabled; DB row is unusable, env still works', async () => {
  const { service } = make({
    env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-env' }), // no ENCRYPTION_KEY
    state: { credential: { ...sealed('unused'), lastFour: 'AAAA', validatedAt: null } },
  });
  assert.equal(service.keyManagementEnabled, false);
  assert.equal(await service.getResolvedApiKey(), 'sk-or-env');
});

// ---------- the central gate ----------

test('system disabled → runtime disabled (SYSTEM_DISABLED) and every feature off', async () => {
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-x' }),
    state: { settings: { systemEnabled: false } },
  });
  const rt = await service.resolveRuntime();
  assert.equal(rt.enabled, false);
  if (!rt.enabled) assert.equal(rt.reason, 'SYSTEM_DISABLED');
  assert.equal(await service.isFeatureEnabled('report_narrative'), false);
});

test('features default ON when unconfigured; a single feature can be turned off', async () => {
  const on = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  assert.equal(await on.service.isFeatureEnabled('nl_query'), true);

  const off = make({
    env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }),
    state: { settings: { systemEnabled: true, features: { nl_query: false } } },
  });
  assert.equal(await off.service.isFeatureEnabled('nl_query'), false);
  assert.equal(await off.service.isFeatureEnabled('report_narrative'), true);
});

test('requireProviderForFeature throws AI_DISABLED (no key) / AI_FEATURE_DISABLED (toggled off)', async () => {
  const noKey = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }) });
  await assert.rejects(
    noKey.service.requireProviderForFeature('report_narrative'),
    (e: unknown) => e instanceof AppError && e.code === 'AI_DISABLED',
  );

  const off = make({
    env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }),
    state: { settings: { systemEnabled: true, features: { report_narrative: false } } },
  });
  await assert.rejects(
    off.service.requireProviderForFeature('report_narrative'),
    (e: unknown) => e instanceof AppError && e.code === 'AI_FEATURE_DISABLED',
  );
});

// ---------- resolved settings (DB wins, env fallback) ----------

test('model default: DB wins over env; else env fallback', async () => {
  const envOnly = make({ env: baseEnv({ AI_MODEL_DEFAULT: 'env/model' }) });
  assert.equal(await envOnly.service.getModelDefault(), 'env/model');

  const dbWins = make({
    env: baseEnv({ AI_MODEL_DEFAULT: 'env/model' }),
    state: { settings: { modelDefault: 'anthropic/claude-opus-4.8' } },
  });
  assert.equal(await dbWins.service.getModelDefault(), 'anthropic/claude-opus-4.8');
});

// ---------- live models list + selection ----------

test('getModels throws AI_NOT_CONFIGURED when no key is set', async () => {
  const { service } = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }) });
  await assert.rejects(
    service.getModels(),
    (e: unknown) => e instanceof AppError && e.code === 'AI_NOT_CONFIGURED',
  );
});

test('getModels returns the live, multi-provider list for the current key', async () => {
  const { service } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  const { models } = await service.getModels();
  const providers = new Set(models.map((m) => m.provider));
  assert.ok(providers.has('anthropic'));
  assert.ok(providers.has('openai'));
  assert.ok(providers.has('deepseek')); // not filtered to a single provider
});

test('updateModels persists a slug that exists in the live list (heavy falls back to default)', async () => {
  const { service, state } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  await service.updateModels('openai/gpt-5', null, ACTOR);
  assert.equal(state.settings?.modelDefault, 'openai/gpt-5');
  assert.equal(state.settings?.modelHeavy, 'openai/gpt-5'); // heavy ← default
});

test('updateModels rejects a slug NOT in the live list (frontend value is not trusted)', async () => {
  const { service, state } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  await assert.rejects(
    service.updateModels('evil/backdoor-model', null, ACTOR),
    (e: unknown) => e instanceof ValidationError,
  );
  assert.equal(state.settings, null);
});

// ---------- updateSettings: no longer handles models ----------

test('updateSettings persists toggles/budget and audits (no secrets)', async () => {
  const { service, state, logged } = make({ env: baseEnv({}) });
  await service.updateSettings({ systemEnabled: false, monthlyTokenBudget: 5000 }, ACTOR);
  assert.equal(state.settings?.systemEnabled, false);
  assert.equal(state.settings?.monthlyTokenBudget, 5000);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.input.entity, 'AiSetting');
});

test('partial feature toggle merges onto stored flags (others preserved)', async () => {
  const { service, state } = make({
    env: baseEnv({}),
    state: { settings: { features: { report_narrative: false, nl_query: true } } },
  });
  await service.updateSettings({ features: { save_guard: false } }, ACTOR);
  const f = state.settings?.features as Record<string, boolean>;
  assert.equal(f.save_guard, false);
  assert.equal(f.report_narrative, false);
  assert.equal(f.nl_query, true);
});

// ---------- setApiKey: validate + fetch models, never leak ----------

test('setApiKey stores an encrypted VALIDATED key, records the model count, returns a masked result', async () => {
  const { service, state, logged } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: async () => ({ ok: true }),
  });
  const result = await service.setApiKey('sk-or-REALKEY-1234', ACTOR);

  assert.deepEqual(result, { configured: true, maskedKey: '••••••1234', modelCount: MODELS.length });
  assert.ok(state.credential);
  assert.notEqual(state.credential!.ciphertext, 'sk-or-REALKEY-1234');
  assert.equal(state.credential!.lastFour, '1234');
  assert.equal(state.credential!.validatedModelCount, MODELS.length);

  // The public DTO carries only status + lastFour — NEVER the key/ciphertext.
  const dto = await service.getPublicSettings({} as never);
  const serialized = JSON.stringify(dto);
  assert.ok(!serialized.includes('sk-or-REALKEY-1234'));
  assert.ok(!serialized.includes(state.credential!.ciphertext));
  assert.equal(dto.key.status, 'set_db');
  assert.equal(dto.configured, true);
  assert.equal(dto.modelCount, MODELS.length);

  const auditNew = JSON.stringify(
    logged.find((l) => l.input.entity === 'AiProviderCredential')?.input.newValues,
  );
  assert.ok(!auditNew.includes('sk-or-REALKEY-1234'));
  assert.ok(auditNew.includes('1234'));
});

test('setApiKey rejects an invalid key and stores NOTHING', async () => {
  const { service, state } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: async () => ({ ok: false, reason: 'invalid' }),
  });
  await assert.rejects(
    service.setApiKey('sk-or-BADKEY', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_INVALID',
  );
  assert.equal(state.credential, null);
});

test('setApiKey refuses when OpenRouter is unreachable (unverified → not stored)', async () => {
  const { service, state } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: async () => ({ ok: false, reason: 'unreachable' }),
  });
  await assert.rejects(
    service.setApiKey('sk-or-x', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_UNVERIFIED',
  );
  assert.equal(state.credential, null);
});

test('setApiKey does NOT store the key when the model fetch fails (models unreachable)', async () => {
  const { service, state } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: async () => ({ ok: true }),
    fetcher: async () => {
      throw new Error('models endpoint down');
    },
  });
  await assert.rejects(
    service.setApiKey('sk-or-x', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_UNVERIFIED',
  );
  assert.equal(state.credential, null);
});

test('setApiKey is allowed even when an env fallback key exists (DB is primary)', async () => {
  const { service, state } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-env' }),
    keyChecker: async () => ({ ok: true }),
  });
  const result = await service.setApiKey('sk-or-new-9999', ACTOR);
  assert.equal(result.configured, true);
  assert.ok(state.credential); // stored, not blocked by the env key
  // The DB key now WINS over the env fallback.
  assert.equal(await service.getResolvedApiKey(), 'sk-or-new-9999');
});

test('setApiKey is blocked when key management is disabled (no ENCRYPTION_KEY)', async () => {
  const { service } = make({ env: baseEnv({}), keyChecker: async () => ({ ok: true }) });
  await assert.rejects(
    service.setApiKey('sk-or-x', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_MANAGEMENT_DISABLED',
  );
});

test('clearApiKey removes the DB credential, invalidates the model cache, and audits', async () => {
  const { service, state, logged, models } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    state: { credential: { ...sealed('sk-or-DB'), lastFour: 'oDB', validatedAt: new Date() } },
  });
  let invalidated = false;
  const orig = models.invalidate.bind(models);
  models.invalidate = () => {
    invalidated = true;
    orig();
  };
  await service.clearApiKey(ACTOR);
  assert.equal(state.credential, null);
  assert.equal(invalidated, true);
  assert.ok(logged.some((l) => l.input.action === 'DELETE'));
});

// ---------- capability guard ----------

test('assertModelSupportsTools throws AI_MODEL_TOOLS_UNSUPPORTED for a known no-tools model', async () => {
  const { service } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  await service.getModels(); // warm the cache so capabilities are known
  await assert.rejects(
    service.assertModelSupportsTools('deepseek/deepseek-r1:free'),
    (e: unknown) => e instanceof AppError && e.code === 'AI_MODEL_TOOLS_UNSUPPORTED',
  );
});

test('assertModelSupportsTools fails OPEN when the model/capabilities are unknown', async () => {
  const { service } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  // Cache cold → capabilities unknown → must not throw.
  await service.assertModelSupportsTools('some/uncached-model');
});

// ---------- key status shapes ----------

test('getPublicSettings key status: set_env / set_db / unset', async () => {
  const envSet = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-envkeyCAFE' }) });
  const envDto = await envSet.service.getPublicSettings({} as never);
  assert.equal(envDto.key.status, 'set_env');
  assert.equal(envDto.key.managedByEnv, true);

  const unset = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }) });
  const dto = await unset.service.getPublicSettings({} as never);
  assert.equal(dto.key.status, 'unset');
  assert.equal(dto.configured, false);
  assert.equal(dto.keyManagementEnabled, true);
});
