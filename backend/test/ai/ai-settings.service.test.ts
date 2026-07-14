/**
 * Phase-2.5 tests for the central AiSettingsService: key resolution (env WINS),
 * the feature gate, the model allow-list, live-validate-before-store, and the
 * guarantee that no method returns the raw key. Repo/audit/key-check faked.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiSettingsService } from '../../src/modules/ai-assistant/services/ai-settings.service.js';
import { SecretCipher } from '../../src/lib/crypto/secret-cipher.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { AppConfig } from '../../src/config/app-config.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { KeyCheckResult } from '../../src/lib/ai/openrouter-key-check.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { ValidationError } from '../../src/shared/errors/validation.error.js';
import { randomBytes } from 'node:crypto';

const ENC_KEY = randomBytes(32).toString('hex');
const ACTOR: AuditActor = { userId: 'user-1' };

function baseEnv(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
    AI_MODEL_DEFAULT: 'anthropic/claude-sonnet-4.6',
    AI_REQUEST_TIMEOUT_MS: 5000,
    AI_MATERIAL_PRICE_SOURCES: [],
    ...overrides,
  } as AppConfig;
}

interface FakeState {
  settings: Record<string, unknown> | null;
  credential: { ciphertext: string; iv: string; authTag: string; lastFour: string; validatedAt: Date | null } | null;
}

function fakeRepo(state: FakeState) {
  return {
    findSettings: async () => state.settings,
    findActiveCredential: async () => state.credential,
    saveSettings: async (data: Record<string, unknown>) => {
      state.settings = { ...(state.settings ?? {}), ...data };
      return state.settings;
    },
    saveCredential: async (data: FakeState['credential']) => {
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
}) {
  const state: FakeState = { settings: opts.state?.settings ?? null, credential: opts.state?.credential ?? null };
  const { audit, logged } = fakeAudit();
  const service = new AiSettingsService({
    repo: fakeRepo(state),
    audit,
    env: opts.env ?? baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: opts.keyChecker,
  });
  return { service, state, logged };
}

// ---------- key resolution: env WINS ----------

test('env key wins over a DB key (E3)', async () => {
  const cipher = new SecretCipher(ENC_KEY);
  const sealed = cipher.encrypt('sk-or-DB-KEY');
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-ENV-KEY' }),
    state: { credential: { ...sealed, lastFour: 'YKEY', validatedAt: new Date() } },
  });
  assert.equal(await service.getResolvedApiKey(), 'sk-or-ENV-KEY');
  assert.equal(service.keyManagedByEnv, true);
});

test('DB key is used (decrypted) when no env key is set', async () => {
  const cipher = new SecretCipher(ENC_KEY);
  const sealed = cipher.encrypt('sk-or-DB-KEY');
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    state: { credential: { ...sealed, lastFour: 'DKEY', validatedAt: new Date() } },
  });
  assert.equal(await service.getResolvedApiKey(), 'sk-or-DB-KEY');
  assert.equal(service.keyManagedByEnv, false);
});

test('no ENCRYPTION_KEY → key management disabled; DB key is unusable', async () => {
  const { service } = make({
    env: baseEnv({}), // no ENCRYPTION_KEY, no env key
    state: { credential: { ciphertext: 'x', iv: 'y', authTag: 'z', lastFour: 'AAAA', validatedAt: null } },
  });
  assert.equal(service.keyManagementEnabled, false);
  assert.equal(await service.getResolvedApiKey(), null); // can't decrypt without the key
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
  assert.equal(await service.isFeatureEnabled('save_guard'), false);
});

test('features default ON when unconfigured; a single feature can be turned off', async () => {
  const { service } = make({ env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }) });
  assert.equal(await service.isFeatureEnabled('nl_query'), true);

  const off = make({
    env: baseEnv({ OPENROUTER_API_KEY: 'sk-or-x' }),
    state: { settings: { systemEnabled: true, features: { nl_query: false } } },
  });
  assert.equal(await off.service.isFeatureEnabled('nl_query'), false);
  assert.equal(await off.service.isFeatureEnabled('report_narrative'), true); // others stay on
});

test('requireProviderForFeature throws AI_DISABLED (no key) / AI_FEATURE_DISABLED (toggled off)', async () => {
  const noKey = make({ env: baseEnv({}) });
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

// ---------- updateSettings: allow-list ----------

test('updateSettings rejects a model outside the allow-list', async () => {
  const { service } = make({ env: baseEnv({}) });
  await assert.rejects(
    service.updateSettings({ modelDefault: 'evil/backdoor-model' }, ACTOR),
    (e: unknown) => e instanceof ValidationError,
  );
});

test('updateSettings accepts an allow-listed model and audits (no secrets)', async () => {
  const { service, state, logged } = make({ env: baseEnv({}) });
  await service.updateSettings({ modelDefault: 'anthropic/claude-opus-4.8', systemEnabled: false }, ACTOR);
  assert.equal(state.settings?.modelDefault, 'anthropic/claude-opus-4.8');
  assert.equal(state.settings?.systemEnabled, false);
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
  assert.equal(f.save_guard, false); // newly set
  assert.equal(f.report_narrative, false); // preserved
  assert.equal(f.nl_query, true); // preserved
});

// ---------- setApiKey: validate-before-store, never leak ----------

test('setApiKey stores an encrypted, VALIDATED key; getPublicSettings never returns it', async () => {
  const { service, state, logged } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    keyChecker: async () => ({ ok: true }),
  });
  await service.setApiKey('sk-or-REALKEY-1234', ACTOR);

  // Stored as ciphertext, not plaintext.
  assert.ok(state.credential);
  assert.notEqual(state.credential!.ciphertext, 'sk-or-REALKEY-1234');
  assert.equal(state.credential!.lastFour, '1234');
  assert.ok(state.credential!.validatedAt);

  // The public DTO carries only status + lastFour — NEVER the key.
  const dto = await service.getPublicSettings({} as never);
  const serialized = JSON.stringify(dto);
  assert.ok(!serialized.includes('sk-or-REALKEY-1234'));
  assert.ok(!serialized.includes(state.credential!.ciphertext));
  assert.equal(dto.key.status, 'set_db');
  assert.equal(dto.key.lastFour, '1234');

  // Audit recorded the change WITHOUT the key/ciphertext.
  const auditNew = JSON.stringify(logged.find((l) => l.input.entity === 'AiProviderCredential')?.input.newValues);
  assert.ok(!auditNew.includes('sk-or-REALKEY-1234'));
  assert.ok(auditNew.includes('1234')); // lastFour is fine
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

test('setApiKey is blocked when the key is env-managed', async () => {
  const { service } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-env' }),
    keyChecker: async () => ({ ok: true }),
  });
  await assert.rejects(
    service.setApiKey('sk-or-new', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_ENV_MANAGED',
  );
});

test('setApiKey is blocked when key management is disabled (no ENCRYPTION_KEY)', async () => {
  const { service } = make({ env: baseEnv({}), keyChecker: async () => ({ ok: true }) });
  await assert.rejects(
    service.setApiKey('sk-or-x', ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_KEY_MANAGEMENT_DISABLED',
  );
});

test('clearApiKey removes the DB credential and audits', async () => {
  const cipher = new SecretCipher(ENC_KEY);
  const sealed = cipher.encrypt('sk-or-DB');
  const { service, state, logged } = make({
    env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }),
    state: { credential: { ...sealed, lastFour: 'oDB', validatedAt: new Date() } },
  });
  await service.clearApiKey(ACTOR);
  assert.equal(state.credential, null);
  assert.ok(logged.some((l) => l.input.action === 'DELETE'));
});

// ---------- key status shapes ----------

test('getPublicSettings key status: set_env / set_db / unset', async () => {
  const envSet = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY, OPENROUTER_API_KEY: 'sk-or-envkeyCAFE' }) });
  assert.equal((await envSet.service.getPublicSettings({} as never)).key.status, 'set_env');

  const unset = make({ env: baseEnv({ ENCRYPTION_KEY: ENC_KEY }) });
  const dto = await unset.service.getPublicSettings({} as never);
  assert.equal(dto.key.status, 'unset');
  assert.equal(dto.key.managedByEnv, false);
  assert.equal(dto.keyManagementEnabled, true);
});
