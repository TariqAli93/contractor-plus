import type { PrismaClient } from '@prisma/client';
import type { AuditActor } from '../../audit/audit.service.js';
import type { CustomersService } from '../../customers/customers.service.js';
import type { ProjectsService } from '../../projects/projects.service.js';
import type { ContractsService } from '../../contracts/contracts.service.js';
import type { CostsService } from '../../costs/costs.service.js';
import type { PaymentsService } from '../../payments/payments.service.js';
import type { TemplatesService } from '../../templates/templates.service.js';
import type { UsersService } from '../../users/users.service.js';
import type { ReportsService } from '../../reports/reports.service.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type { AccessService } from '../../rbac/access.service.js';

// The fixed catalogue of tool names. The provider may ONLY call one of these;
// anything else is rejected before any code runs (binding rule #6).
export const TOOL_NAMES = [
  'create_customer',
  'create_project',
  'create_contract',
  'create_expense',
  'create_payment',
  'create_template',
  'create_user',
  'generate_report',
  'update_app_settings',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** The authenticated caller, with their EFFECTIVE permissions already resolved. */
export interface ToolActor {
  userId: string;
  role: string;
  isOwner: boolean;
  /** Effective permission keys (empty + isOwner=true means super-admin). */
  permissions: ReadonlySet<string>;
  /** For the audit + service calls. */
  audit: AuditActor;
}

/** The domain services a tool may call. NO tool ever touches Prisma for domain
 *  data — writes go through these public services (binding rules #1, #2). */
export interface ToolServices {
  customers: CustomersService;
  projects: ProjectsService;
  contracts: ContractsService;
  costs: CostsService;
  payments: PaymentsService;
  templates: TemplatesService;
  users: UsersService;
  reports: ReportsService;
  settings: SettingsService;
  /** Resolves a role's effective permissions — the privilege-escalation guard. */
  access: AccessService;
  /** ONLY for a tool to open a $transaction around a service's *WithinTx create. */
  prisma: PrismaClient;
}

export interface ToolContext {
  actor: ToolActor;
  services: ToolServices;
  /**
   * Secrets provided at CONFIRM time (a secure field in the dialog) — never sent
   * to the model, never stored in the pending action. e.g. { password }.
   */
  secrets?: Record<string, string>;
}

export interface ToolPreviewField {
  label: string;
  value: string;
}

export interface ToolPreviewChange {
  label: string;
  oldValue: string;
  newValue: string;
}

/** What the confirmation dialog renders. Arabic, human-readable, content-safe. */
export interface ToolPreview {
  title: string;
  summary: string;
  fields: ToolPreviewField[];
  /** old→new for update tools (e.g. app settings). */
  changes?: ToolPreviewChange[];
  warnings: string[];
}

export interface ToolExecuteResult {
  /** Id of the created/affected record (traceability), or null (e.g. a report). */
  recordId: string | null;
  /** The module the write hit (audit source module), e.g. 'customers'. */
  module: string;
  /** Content-free Arabic summary for the audit log + toast. */
  summary: string;
  /** The result payload for the UI — already free of secrets. */
  data: unknown;
}

/**
 * One AI-callable action. Definitions are pure data + four functions; they hold
 * NO business logic of their own — validation reuses the module DTO/zod schema
 * and every write goes through the module Service (binding rules #3, #4).
 */
export interface AiTool<Args = unknown> {
  readonly name: ToolName;
  /** Arabic description shown to the model. */
  readonly description: string;
  /** JSON Schema for OpenRouter's `tools[].function.parameters`. */
  readonly parametersSchema: Record<string, unknown>;
  /** Permissions ALL required to run this tool (checked in the backend). */
  readonly requiredPermissions: readonly string[];
  /** Write tools require an explicit confirm; read tools (reports) do not. */
  readonly requiresConfirmation: boolean;
  /**
   * Secret field names collected in the confirm dialog and passed via
   * ctx.secrets at execution — NEVER sent to the model, NEVER stored in the
   * pending action, NEVER logged (e.g. ['password'] for create_user).
   */
  readonly requiredSecrets?: readonly string[];

  /** Parse + normalize the raw model arguments (zod). Throws ValidationError. */
  validate(rawArgs: unknown, ctx: ToolContext): Promise<Args>;
  /** Build the confirmation preview WITHOUT mutating (may run existence/dup checks). */
  preview(args: Args, ctx: ToolContext): Promise<ToolPreview>;
  /** Perform the write via the module Service. Atomic per tool. */
  execute(args: Args, ctx: ToolContext): Promise<ToolExecuteResult>;
  /** Redact a result before it is logged or returned (never a secret). */
  sanitizeResult(result: ToolExecuteResult): unknown;
}

// ---------------------------------------------------------------------------
// Wire DTOs (backend → SPA)
// ---------------------------------------------------------------------------

/** A write the assistant proposed, awaiting the user's explicit confirm. */
export interface PendingActionDto {
  actionId: string;
  toolName: ToolName;
  title: string;
  /** The validated, normalized arguments (NEVER a secret). */
  normalizedArguments: Record<string, unknown>;
  preview: ToolPreview;
  warnings: string[];
  /** Secret field names the confirm dialog must collect (e.g. ['password']). */
  requiredSecrets: string[];
  expiresAt: string;
}

/** The result of a read-only tool the assistant ran directly. */
export interface ToolResultDto {
  toolName: ToolName;
  module: string;
  summary: string;
  data: unknown;
}

/** One assistant turn: a message, any read results, and any pending writes. */
export interface AgentTurnResult {
  message: string;
  pendingActions: PendingActionDto[];
  toolResults: ToolResultDto[];
}
