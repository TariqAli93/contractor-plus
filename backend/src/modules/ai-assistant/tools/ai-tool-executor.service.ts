/* eslint-disable @typescript-eslint/no-explicit-any */
import { RoleName } from '@contractor-plus/shared';
import { ForbiddenError } from '../../../shared/errors/forbidden.error.js';
import type { AuditActor } from '../../audit/audit.service.js';
import type {
  AiTool,
  ToolActor,
  ToolContext,
  ToolExecuteResult,
  ToolPreview,
  ToolServices,
} from './ai-tool.types.js';

export interface ToolRequestUser {
  id: string;
  role: string;
}

// Stateless helpers around a tool: resolve the caller's effective permissions,
// gate the tool, and run its validate → preview → execute chain. The BACKEND is
// where permissions are enforced (never trusting the SPA or the model).
export class AiToolExecutorService {
  constructor(private readonly services: ToolServices) {}

  /** Resolve the caller into a ToolActor with their effective permission set. */
  async resolveActor(user: ToolRequestUser, audit: AuditActor): Promise<ToolActor> {
    const isOwner = user.role === RoleName.OWNER;
    const keys = isOwner ? [] : await this.services.access.permissionsForRole(user.role);
    return { userId: user.id, role: user.role, isOwner, permissions: new Set(keys), audit };
  }

  buildContext(actor: ToolActor, secrets?: Record<string, string>): ToolContext {
    return { actor, services: this.services, ...(secrets ? { secrets } : {}) };
  }

  /** Throws unless the actor holds EVERY permission the tool requires (OWNER bypass). */
  ensurePermissions(tool: AiTool<any>, actor: ToolActor): void {
    if (actor.isOwner) return;
    for (const p of tool.requiredPermissions) {
      if (!actor.permissions.has(p)) {
        throw new ForbiddenError('لا تملك صلاحية تنفيذ هذه العملية عبر المساعد.', 'AI_TOOL_FORBIDDEN');
      }
    }
  }

  validate(tool: AiTool<any>, rawArgs: unknown, ctx: ToolContext): Promise<any> {
    return tool.validate(rawArgs, ctx);
  }

  preview(tool: AiTool<any>, args: any, ctx: ToolContext): Promise<ToolPreview> {
    return tool.preview(args, ctx);
  }

  execute(tool: AiTool<any>, args: any, ctx: ToolContext): Promise<ToolExecuteResult> {
    return tool.execute(args, ctx);
  }
}
