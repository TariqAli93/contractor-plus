// ============================================================
// The Tool contract — the generalization of ai-command's ActionDef.
//
// Every AI capability is a Tool: metadata + declared permissions + granular
// actions (tx-aware runners, exactly like ActionDef's runInTx/runStandalone/
// runQuery) + an optional NL `interpret()` entry (a tool may own a domain LLM
// call — EstimationTool reuses its existing service) + optional deterministic
// rules contributed to the Business Rules Engine. A `renderKind` drives the
// frontend renderer registry.
// ============================================================

import type { Prisma, PrismaClient } from '@prisma/client';
import type { PermissionDef } from '../../rbac/rbac.catalog.js';
import type { EstimationTemplatesService } from '../../estimation-templates/estimation-templates.service.js';
import type { ActionDeps } from '../../ai-command-workflow/ai-command-workflow.registry.js';
import type { AiCommandRepository } from '../../ai-command-workflow/ai-command-workflow.repository.js';
import type { LlmClient } from '../../../lib/llm/llm-client.js';
import type { LlmProviderName } from '../../../lib/llm/llm.config.js';
import type { RuleEngine, RuleFn } from '../rules/rule-engine.js';
import type { ActionOutcome, Principal, ToolTurnResult } from '../ai-platform.types.js';

/** The bridged legacy AI-command capability: its domain-service bag + repository
 *  + a lazy LLM-client resolver (an injected fake in tests, settings-resolved in
 *  prod). Built ONCE by buildToolDeps and reused, so the ~13 domain services are
 *  not rebuilt every turn. Consumed only by the unified assistant's CommandTool. */
export interface CommandToolDeps {
  deps: ActionDeps;
  repo: AiCommandRepository;
  resolveClient: () => Promise<{ client: LlmClient | null; provider: LlmProviderName | null }>;
}

/** Domain-service bag threaded to every action — generalizes ActionDeps.
 *  Each tool reads only its own slice (EstimationTool → `estimation`,
 *  CommandTool → `command`). */
export interface ToolDeps {
  prisma: PrismaClient;
  estimation: EstimationTemplatesService;
  command: CommandToolDeps;
}

/** Caller + effective perms + the collaborators an action/tool needs. */
export interface PlatformContext extends Principal {
  permissions: Set<string>;
  deps: ToolDeps;
  rules: RuleEngine;
  /** Prior-turn conversation memory as a compact preamble, so a tool's own LLM
   *  call carries context without the user repeating themselves. Absent/empty on
   *  the first turn of a session. */
  conversation?: { preamble: string };
}

/** A minimal, persistence-backed view of the active session handed to a tool, so
 *  tools never import the Prisma model or the SessionManager directly. */
export interface SessionHandle {
  id: string;
  userId: string;
  workingState: unknown | null;
  contextRefs: Record<string, string>;
  /** Persist tool-scoped working state (and mark this tool active). */
  setWorkingState(state: unknown): Promise<void>;
}

/** A granular action the executor runs (mirrors ActionDef's runner trio). */
export interface ToolAction {
  name: string; // unqualified; qualified as `${tool.name}.${name}`
  kind: 'mutation' | 'query';
  description: string;
  requiredPermissions: string[];
  inputSchema: import('zod').ZodTypeAny;
  /** Compoundable mutation — runs inside the executor's shared $transaction.
   *  May return several outcomes (e.g. a bridged multi-step plan). */
  runInTx?(ctx: PlatformContext, tx: Prisma.TransactionClient, session: SessionHandle, input: Record<string, unknown>, refs: Record<string, string>): Promise<ActionOutcome | ActionOutcome[] | null>;
  /** Single mutation — manages its own transaction (e.g. delegates to a service).
   *  May return several outcomes (CommandTool's execute runs a whole plan). */
  runStandalone?(ctx: PlatformContext, session: SessionHandle, input: Record<string, unknown>, refs: Record<string, string>): Promise<ActionOutcome | ActionOutcome[] | null>;
  /** Read-only — no confirmation, no write. */
  runQuery?(ctx: PlatformContext, session: SessionHandle, input: Record<string, unknown>, refs: Record<string, string>): Promise<unknown>;
}

export interface Tool {
  name: string;
  displayName: string;
  version: string;
  permissionModule: string;
  renderKind: string;
  actions: ToolAction[];
  rules?: RuleFn[];
  /** Permissions required to use this tool's NL entry (`interpret`). */
  interpretPermissions?: string[];
  /** This tool's permissions → the RBAC catalog (zero-migration). */
  contributePermissions(): PermissionDef[];
  /** NL entry: interpret one turn against the session, may call a domain LLM,
   *  updates working state, returns a clarification/preview/query/rejected. */
  interpret?(ctx: PlatformContext, session: SessionHandle, text: string): Promise<ToolTurnResult>;
  /** Cleanup when a session/plan is cancelled (e.g. cancel the draft). */
  onCancel?(ctx: PlatformContext, session: SessionHandle): Promise<void>;
}
