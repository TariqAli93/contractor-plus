/**
 * Phase-8 tests for the AI tools/actions layer. The pending-action repo, the AI
 * request-log repo, the audit service, and the domain services are all faked so
 * the propose → confirm → execute lifecycle is exercised deterministically with
 * no live DB (the Prisma paths run in the acceptance suite).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTool,
  isRegisteredTool,
  listTools,
  toolDefinitionsForProvider,
} from '../../src/modules/ai-assistant/tools/ai-tool.registry.js';
import { AiToolExecutorService } from '../../src/modules/ai-assistant/tools/ai-tool-executor.service.js';
import { AiToolConfirmationService } from '../../src/modules/ai-assistant/tools/ai-tool-confirmation.service.js';
import type { AiPendingActionRepository } from '../../src/modules/ai-assistant/tools/ai-pending-action.repository.js';
import type { ToolActor, ToolServices } from '../../src/modules/ai-assistant/tools/ai-tool.types.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { AuditService } from '../../src/modules/audit/audit.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface AuditEntry {
  entity: string;
  entityId: string;
  newValues: Record<string, unknown>;
}

function fakeAudit(sink: AuditEntry[]) {
  return {
    log: async (_actor: unknown, input: AuditEntry) => {
      sink.push(input);
    },
  } as unknown as AuditService;
}

function fakeAiRepo(logs: Record<string, unknown>[]) {
  let n = 0;
  return {
    createRequestLog: async (data: Record<string, unknown>) => {
      logs.push(data);
      return { id: `log-${++n}` };
    },
  } as unknown as AiAssistantRepository;
}

interface Row {
  id: string;
  userId: string;
  toolName: string;
  argumentsJson: unknown;
  previewJson: unknown;
  status: string;
  expiresAt: Date;
  resultRecordId: string | null;
  errorCode: string | null;
}

function fakePendingRepo() {
  const rows = new Map<string, Row>();
  let n = 0;
  const repo = {
    create: async (data: {
      userId: string;
      toolName: string;
      argumentsJson: unknown;
      previewJson: unknown;
      idempotencyKey: string;
      expiresAt: Date;
    }) => {
      const row: Row = {
        id: `act-${++n}`,
        userId: data.userId,
        toolName: data.toolName,
        argumentsJson: data.argumentsJson,
        previewJson: data.previewJson,
        status: 'PENDING',
        expiresAt: data.expiresAt,
        resultRecordId: null,
        errorCode: null,
      };
      rows.set(row.id, row);
      return row;
    },
    findForUser: async (id: string, userId: string) => {
      const r = rows.get(id);
      return r && r.userId === userId ? r : null;
    },
    listPendingForUser: async (userId: string) =>
      [...rows.values()].filter((r) => r.userId === userId && r.status === 'PENDING'),
    claimForExecution: async (id: string, userId: string, now: Date) => {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== 'PENDING' || r.expiresAt.getTime() <= now.getTime())
        return null;
      r.status = 'CONFIRMED';
      return r;
    },
    markExecuted: async (id: string, recordId: string | null) => {
      const r = rows.get(id)!;
      r.status = 'EXECUTED';
      r.resultRecordId = recordId;
      return r;
    },
    markFailed: async (id: string, code: string) => {
      const r = rows.get(id)!;
      r.status = 'FAILED';
      r.errorCode = code;
      return r;
    },
    reject: async (id: string, userId: string) => {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== 'PENDING') return 0;
      r.status = 'REJECTED';
      return 1;
    },
    setStatus: async (id: string, status: string) => {
      const r = rows.get(id)!;
      r.status = status;
      return r;
    },
    _rows: rows,
  };
  return repo as unknown as AiPendingActionRepository & { _rows: Map<string, Row> };
}

function fakeServices(opts: { duplicatePhone?: string; adminPerms?: string[] } = {}) {
  const created: Array<[string, unknown]> = [];
  const services = {
    customers: {
      create: async (data: Record<string, unknown>) => {
        const c = { id: 'cust-1', ...data };
        created.push(['customers', c]);
        return c;
      },
      findDuplicatesByPhone: async (phone: string | null | undefined) =>
        phone && phone === opts.duplicatePhone ? [{ id: 'old', name: 'عميل قديم' }] : [],
    },
    projects: { create: async (d: Record<string, unknown>) => ({ id: 'proj-1', status: 'PLANNED', ...d }) },
    contracts: {
      create: async (d: Record<string, unknown>) => ({ id: 'con-1', status: 'DRAFT', totalPrice: null, ...d }),
    },
    costs: { create: async (d: Record<string, unknown>) => ({ id: 'cost-1', totalAmount: null, ...d }) },
    payments: { create: async (d: Record<string, unknown>) => ({ id: 'pay-1', status: 'PENDING', ...d }) },
    templates: { create: async (d: Record<string, unknown>) => ({ id: 'tpl-1', isActive: true, ...d }) },
    users: {
      create: async (data: Record<string, unknown>) => {
        created.push(['users', { ...data }]);
        return { id: 'user-1', username: data.username, fullName: data.fullName, isActive: true };
      },
    },
    reports: {
      getCashFlow: async (q: unknown) => ({ report: 'cash_flow', q }),
      getOverduePayments: async () => [],
      getDelayedProjects: async () => [],
      listProjectProfitability: async () => ({ items: [], total: 0 }),
    },
    settings: {
      getGeneral: async () => ({ appName: 'قديم', fiscalYearStartMonth: 1, defaultLocale: 'ar', dateFormat: 'YYYY-MM-DD' }),
      updateGeneral: async (d: Record<string, unknown>) => ({ appName: 'قديم', ...d }),
    },
    access: {
      permissionsForRole: async (role: string) =>
        role === 'ADMIN' ? (opts.adminPerms ?? ['customers.create', 'users.create']) : [],
    },
    prisma: {},
    _created: created,
  };
  return services as unknown as ToolServices & { _created: Array<[string, unknown]> };
}

function ownerActor(): ToolActor {
  return {
    userId: 'u-owner',
    role: 'OWNER',
    isOwner: true,
    permissions: new Set<string>(),
    audit: { userId: 'u-owner' },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry exposes the nine tools with stable names', () => {
  const names = listTools().map((t) => t.name).sort();
  assert.deepEqual(names, [
    'create_contract',
    'create_customer',
    'create_expense',
    'create_payment',
    'create_project',
    'create_template',
    'create_user',
    'generate_report',
    'update_app_settings',
  ]);
  assert.equal(toolDefinitionsForProvider().length, 9);
});

test('registry rejects an unregistered tool', () => {
  assert.equal(isRegisteredTool('drop_table'), false);
  assert.equal(getTool('drop_table'), undefined);
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test('executor denies a tool when the actor lacks a required permission', async () => {
  const executor = new AiToolExecutorService(fakeServices());
  const actor: ToolActor = {
    userId: 'u1',
    role: 'ENGINEER',
    isOwner: false,
    permissions: new Set(['ai.use']), // missing ai.apply-suggestions + customers.create
    audit: { userId: 'u1' },
  };
  assert.throws(
    () => executor.ensurePermissions(getTool('create_customer')!, actor),
    (e: unknown) => e instanceof AppError && e.code === 'AI_TOOL_FORBIDDEN',
  );
});

test('owner bypasses the permission gate', () => {
  const executor = new AiToolExecutorService(fakeServices());
  executor.ensurePermissions(getTool('create_user')!, ownerActor()); // does not throw
});

// ---------------------------------------------------------------------------
// Propose → confirm lifecycle (the acceptance path)
// ---------------------------------------------------------------------------

function buildConfirmation(opts: Parameters<typeof fakeServices>[0] = {}) {
  const audit: AuditEntry[] = [];
  const logs: Record<string, unknown>[] = [];
  const services = fakeServices(opts);
  const repo = fakePendingRepo();
  const executor = new AiToolExecutorService(services);
  const confirmation = new AiToolConfirmationService({
    repo,
    aiRepo: fakeAiRepo(logs),
    executor,
    audit: fakeAudit(audit),
  });
  return { confirmation, repo, services, audit, logs, executor };
}

test('propose validates + previews but does NOT create the customer', async () => {
  const { confirmation, services } = buildConfirmation();
  const pending = await confirmation.propose(
    'create_customer',
    { name: 'خلدون', phone: '07700000000' },
    ownerActor(),
  );
  assert.equal(pending.toolName, 'create_customer');
  assert.match(pending.preview.summary, /خلدون/);
  assert.ok(pending.expiresAt);
  assert.equal(services._created.length, 0, 'no write happened at propose');
});

test('confirm executes the write once and records a result', async () => {
  const { confirmation, repo, services, audit } = buildConfirmation();
  const pending = await confirmation.propose('create_customer', { name: 'خلدون', phone: '077' }, ownerActor());
  const result = await confirmation.confirm(pending.actionId, undefined, ownerActor());
  assert.equal(result.module, 'customers');
  assert.equal(services._created.length, 1);
  assert.equal((repo._rows.get(pending.actionId) as { status: string }).status, 'EXECUTED');
  const events = audit.map((a) => a.newValues.event);
  assert.ok(events.includes('AI_TOOL_PROPOSED'));
  assert.ok(events.includes('AI_TOOL_CONFIRMED'));
  assert.ok(events.includes('AI_TOOL_EXECUTED'));
});

test('a second confirm of the same actionId is rejected (no double execute)', async () => {
  const { confirmation, services } = buildConfirmation();
  const pending = await confirmation.propose('create_customer', { name: 'خلدون' }, ownerActor());
  await confirmation.confirm(pending.actionId, undefined, ownerActor());
  await assert.rejects(
    () => confirmation.confirm(pending.actionId, undefined, ownerActor()),
    (e: unknown) => e instanceof AppError && e.code === 'AI_ACTION_ALREADY_DONE',
  );
  assert.equal(services._created.length, 1, 'still exactly one write');
});

test('an expired action cannot be confirmed', async () => {
  const { confirmation, repo } = buildConfirmation();
  const pending = await confirmation.propose('create_customer', { name: 'خلدون' }, ownerActor());
  // Force expiry.
  (repo._rows.get(pending.actionId) as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(
    () => confirmation.confirm(pending.actionId, undefined, ownerActor()),
    (e: unknown) => e instanceof AppError && e.code === 'AI_ACTION_EXPIRED',
  );
});

test('rejecting a pending action prevents execution', async () => {
  const { confirmation, services } = buildConfirmation();
  const pending = await confirmation.propose('create_customer', { name: 'خلدون' }, ownerActor());
  await confirmation.reject(pending.actionId, ownerActor());
  await assert.rejects(() => confirmation.confirm(pending.actionId, undefined, ownerActor()));
  assert.equal(services._created.length, 0);
});

test('invalid arguments are rejected at propose (reuses the module schema)', async () => {
  const { confirmation } = buildConfirmation();
  await assert.rejects(
    () => confirmation.propose('create_customer', { name: '' }, ownerActor()),
    (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR',
  );
});

test('duplicate customer surfaces a warning in the preview', async () => {
  const { confirmation } = buildConfirmation({ duplicatePhone: '07700000000' });
  const pending = await confirmation.propose(
    'create_customer',
    { name: 'خلدون', phone: '07700000000' },
    ownerActor(),
  );
  assert.ok(pending.warnings.some((w) => /نفس رقم الهاتف/.test(w)));
});

// ---------------------------------------------------------------------------
// create_user — escalation, password never stored/logged
// ---------------------------------------------------------------------------

test('create_user blocks a role that grants a permission the actor lacks', async () => {
  const { confirmation } = buildConfirmation({ adminPerms: ['users.create', 'settings.manage'] });
  const actor: ToolActor = {
    userId: 'u1',
    role: 'X',
    isOwner: false,
    // Actor may create users but has no settings.manage — creating an ADMIN escalates.
    permissions: new Set(['ai.use', 'ai.apply-suggestions', 'users.create']),
    audit: { userId: 'u1' },
  };
  await assert.rejects(
    () => confirmation.propose('create_user', { username: 'newadmin', fullName: 'مدير جديد', roleName: 'ADMIN' }, actor),
    (e: unknown) => e instanceof AppError && e.code === 'AI_ROLE_ESCALATION',
  );
});

test('create_user never stores the password in the pending action and never logs it', async () => {
  const { confirmation, repo, audit, logs } = buildConfirmation();
  const pending = await confirmation.propose(
    'create_user',
    { username: 'newuser', fullName: 'مستخدم', roleName: 'ACCOUNTANT' },
    ownerActor(),
  );
  const stored = JSON.stringify((repo._rows.get(pending.actionId) as { argumentsJson: unknown }).argumentsJson);
  assert.equal(/password/i.test(stored), false);
  // Execute with the secret; it must not leak into audit or the request log.
  await confirmation.confirm(pending.actionId, { password: 'S3cret-Pass' }, ownerActor());
  assert.equal(/S3cret-Pass|password/i.test(JSON.stringify(audit)), false);
  assert.equal(/S3cret-Pass|password/i.test(JSON.stringify(logs)), false);
});

test('create_user without a password at confirm fails validation', async () => {
  const { confirmation } = buildConfirmation();
  const pending = await confirmation.propose(
    'create_user',
    { username: 'newuser', fullName: 'مستخدم', roleName: 'ACCOUNTANT' },
    ownerActor(),
  );
  await assert.rejects(
    () => confirmation.confirm(pending.actionId, undefined, ownerActor()),
    (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR',
  );
});

// ---------------------------------------------------------------------------
// update_app_settings — strict allowlist
// ---------------------------------------------------------------------------

test('update_app_settings rejects a setting outside the allowlist', async () => {
  const { confirmation } = buildConfirmation();
  await assert.rejects(
    () => confirmation.propose('update_app_settings', { openrouterApiKey: 'sk-live' }, ownerActor()),
    (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR',
  );
});

test('update_app_settings previews old→new for an allowed setting', async () => {
  const { confirmation } = buildConfirmation();
  const pending = await confirmation.propose('update_app_settings', { appName: 'شركتي' }, ownerActor());
  assert.ok(pending.preview.changes && pending.preview.changes.length === 1);
  assert.equal(pending.preview.changes![0].newValue, 'شركتي');
});

// ---------------------------------------------------------------------------
// Audit on failure + rollback signalling
// ---------------------------------------------------------------------------

test('a failing service marks the action FAILED and audits AI_TOOL_FAILED', async () => {
  const { confirmation, repo, audit, services } = buildConfirmation();
  (services.customers as unknown as { create: unknown }).create = async () => {
    throw new AppError(409, 'CUSTOMER_CONFLICT', 'تعارض');
  };
  const pending = await confirmation.propose('create_customer', { name: 'خلدون' }, ownerActor());
  await assert.rejects(() => confirmation.confirm(pending.actionId, undefined, ownerActor()));
  assert.equal((repo._rows.get(pending.actionId) as { status: string }).status, 'FAILED');
  assert.ok(audit.map((a) => a.newValues.event).includes('AI_TOOL_FAILED'));
});
