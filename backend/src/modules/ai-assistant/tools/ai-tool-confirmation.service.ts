/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import type { AiPendingAction, Prisma } from '@prisma/client';
import { AppError } from '../../../shared/errors/app-error.js';
import { NotFoundError } from '../../../shared/errors/not-found.error.js';
import type { AuditAction } from '@prisma/client';
import type { AuditService } from '../../audit/audit.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import { getTool } from './ai-tool.registry.js';
import { AiToolExecutorService } from './ai-tool-executor.service.js';
import { AiPendingActionRepository } from './ai-pending-action.repository.js';
import type {
  PendingActionDto,
  ToolActor,
  ToolPreview,
  ToolResultDto,
} from './ai-tool.types.js';

const PENDING_TTL_MS = 10 * 60 * 1000; // العمليات المعلّقة تنتهي خلال ١٠ دقائق.

type ToolEvent =
  | 'AI_TOOL_PROPOSED'
  | 'AI_TOOL_CONFIRMED'
  | 'AI_TOOL_REJECTED'
  | 'AI_TOOL_EXECUTED'
  | 'AI_TOOL_FAILED'
  | 'AI_TOOL_EXPIRED';

export interface AiToolConfirmationDeps {
  repo: AiPendingActionRepository;
  aiRepo: AiAssistantRepository;
  executor: AiToolExecutorService;
  audit: AuditService;
}

// Owns the pending-action lifecycle. A write NEVER runs off the model's text —
// only through an explicit confirm of a specific actionId, once, before it
// expires. Every transition is audited; the model's prompt and any secret are
// never stored or logged (rules #8, #9, #10).
export class AiToolConfirmationService {
  constructor(private readonly deps: AiToolConfirmationDeps) {}

  /** Validate + preview a write and persist it as PENDING. Never executes. */
  async propose(toolName: string, rawArgs: unknown, actor: ToolActor): Promise<PendingActionDto> {
    const tool = getTool(toolName);
    if (!tool) throw new AppError(400, 'AI_TOOL_UNKNOWN', 'الأداة المطلوبة غير مدعومة.');
    this.deps.executor.ensurePermissions(tool, actor);

    const ctx = this.deps.executor.buildContext(actor);
    const args = await this.deps.executor.validate(tool, rawArgs, ctx);
    const preview = await this.deps.executor.preview(tool, args, ctx);

    // Defense in depth: a secret must never reach the stored arguments.
    const stored = stripSecrets(args, tool.requiredSecrets);

    const row = await this.deps.repo.create({
      userId: actor.userId,
      toolName,
      argumentsJson: stored as Prisma.InputJsonValue,
      previewJson: preview as unknown as Prisma.InputJsonValue,
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });

    await this.audit(actor, 'AI_TOOL_PROPOSED', {
      actionId: row.id,
      toolName,
      module: previewModule(toolName),
    });

    return toDto(row, preview, [...(tool.requiredSecrets ?? [])]);
  }

  /** Execute a PENDING action once, after re-checking permissions + data. */
  async confirm(
    actionId: string,
    secrets: Record<string, string> | undefined,
    actor: ToolActor,
  ): Promise<ToolResultDto> {
    const row = await this.deps.repo.findForUser(actionId, actor.userId);
    if (!row) throw new NotFoundError('AiPendingAction', 'AI_ACTION_NOT_FOUND');

    if (row.status === 'EXECUTED') {
      throw new AppError(409, 'AI_ACTION_ALREADY_DONE', 'تم تنفيذ هذه العملية سابقًا.');
    }
    if (row.status !== 'PENDING') {
      throw new AppError(409, 'AI_ACTION_NOT_PENDING', 'لم تعد هذه العملية قابلة للتنفيذ.');
    }
    const now = new Date();
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.deps.repo.setStatus(actionId, 'EXPIRED');
      await this.audit(actor, 'AI_TOOL_EXPIRED', { actionId, toolName: row.toolName });
      throw new AppError(410, 'AI_ACTION_EXPIRED', 'انتهت صلاحية هذه العملية. أعد الطلب.');
    }

    // Atomic claim PENDING → CONFIRMED — the double-execute guard.
    const claimed = await this.deps.repo.claimForExecution(actionId, actor.userId, now);
    if (!claimed) {
      throw new AppError(409, 'AI_ACTION_ALREADY_DONE', 'تم تنفيذ هذه العملية سابقًا.');
    }

    const tool = getTool(row.toolName);
    if (!tool) {
      await this.deps.repo.markFailed(actionId, 'AI_TOOL_UNKNOWN');
      throw new AppError(400, 'AI_TOOL_UNKNOWN', 'الأداة المطلوبة غير مدعومة.');
    }
    // Re-check permissions + re-validate the stored data at confirm time.
    this.deps.executor.ensurePermissions(tool, actor);
    const ctx = this.deps.executor.buildContext(actor, secrets);
    const args = await this.deps.executor.validate(tool, row.argumentsJson, ctx);

    await this.audit(actor, 'AI_TOOL_CONFIRMED', { actionId, toolName: row.toolName });

    const start = Date.now();
    try {
      const result = await this.deps.executor.execute(tool, args, ctx);
      await this.deps.repo.markExecuted(actionId, result.recordId, new Date());

      await this.deps.aiRepo.createRequestLog({
        userId: actor.userId,
        operationType: 'TOOL_ACTION',
        modelUsed: 'confirm',
        sourceModules: [result.module],
        recordIds: result.recordId ? [result.recordId] : [],
        tokensPrompt: 0,
        tokensCompletion: 0,
        outputSummary: result.summary.slice(0, 160),
      });
      await this.audit(actor, 'AI_TOOL_EXECUTED', {
        actionId,
        toolName: row.toolName,
        module: result.module,
        recordId: result.recordId,
        durationMs: Date.now() - start,
        success: true,
      });

      return {
        toolName: tool.name,
        module: result.module,
        summary: result.summary,
        data: tool.sanitizeResult(result),
      };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_TOOL_EXECUTION_FAILED';
      await this.deps.repo.markFailed(actionId, code);
      await this.audit(actor, 'AI_TOOL_FAILED', {
        actionId,
        toolName: row.toolName,
        durationMs: Date.now() - start,
        success: false,
        errorCode: code,
      });
      throw err;
    }
  }

  async reject(actionId: string, actor: ToolActor): Promise<void> {
    const count = await this.deps.repo.reject(actionId, actor.userId);
    if (count === 0) {
      // Either missing, not the owner's, or no longer PENDING.
      const row = await this.deps.repo.findForUser(actionId, actor.userId);
      if (!row) throw new NotFoundError('AiPendingAction', 'AI_ACTION_NOT_FOUND');
      throw new AppError(409, 'AI_ACTION_NOT_PENDING', 'لم تعد هذه العملية قابلة للرفض.');
    }
    await this.audit(actor, 'AI_TOOL_REJECTED', { actionId });
  }

  async listPending(userId: string): Promise<PendingActionDto[]> {
    const rows = await this.deps.repo.listPendingForUser(userId);
    return rows.map((row) => {
      const tool = getTool(row.toolName);
      return toDto(row, row.previewJson as unknown as ToolPreview, [
        ...(tool?.requiredSecrets ?? []),
      ]);
    });
  }

  private async audit(actor: ToolActor, event: ToolEvent, data: Record<string, unknown>): Promise<void> {
    const action: AuditAction = event === 'AI_TOOL_PROPOSED' ? 'CREATE' : 'UPDATE';
    await this.deps.audit.log(actor.audit, {
      action,
      entity: 'AiPendingAction',
      entityId: String(data.actionId ?? ''),
      // Content-free: the event, the tool, the target module/record — never the
      // prompt, arguments, secrets, or full record content (rule #10).
      newValues: { event, ...data },
    });
  }
}

// ---------------------------------------------------------------------------

function toDto(row: AiPendingAction, preview: ToolPreview, requiredSecrets: string[]): PendingActionDto {
  return {
    actionId: row.id,
    toolName: row.toolName as PendingActionDto['toolName'],
    title: preview.title,
    normalizedArguments: row.argumentsJson as Record<string, unknown>,
    preview,
    warnings: preview.warnings ?? [],
    requiredSecrets,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Remove any declared secret field from an object before it is persisted. */
function stripSecrets(args: any, secrets: readonly string[] | undefined): unknown {
  if (!secrets || secrets.length === 0 || args == null || typeof args !== 'object') return args;
  const clone: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const key of secrets) delete clone[key];
  return clone;
}

/** Best-effort module label for the proposed-event audit (before execution). */
function previewModule(toolName: string): string {
  return toolName.replace(/^create_/, '').replace(/^update_/, '').replace(/^generate_/, '');
}
