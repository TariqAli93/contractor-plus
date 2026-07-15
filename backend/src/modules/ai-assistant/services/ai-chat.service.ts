import type { AiChatMessage } from '@prisma/client';
import { AppError } from '../../../shared/errors/app-error.js';
import { NotFoundError } from '../../../shared/errors/not-found.error.js';
import { extractJsonObject } from '../../../lib/ai/extract-json.js';
import type { AiCompletionResult, AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { ReportsService } from '../../reports/reports.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiSettingsService } from './ai-settings.service.js';
import type { AiBudgetService } from './ai-budget.service.js';
import type { AiValidationService } from './ai-validation.service.js';
import { executeConstrainedReportQuery } from './report-query-executor.js';
import {
  CHAT_QUERY_TOOL,
  CHAT_QUERY_TOOL_NAME,
  chatSystemPrompt,
} from '../prompts/chat-system.js';
import type { AiToolDefinition } from '../../../lib/ai/ai-provider.interface.js';
import { getTool, isRegisteredTool, listTools } from '../tools/ai-tool.registry.js';
import type { AiToolExecutorService } from '../tools/ai-tool-executor.service.js';
import type { AiToolConfirmationService } from '../tools/ai-tool-confirmation.service.js';
import type { PendingActionDto, ToolActor } from '../tools/ai-tool.types.js';
import type {
  ChatMessageDto,
  ChatSendResult,
  ChatThreadDto,
  ChatThreadSummaryDto,
} from '../ai-assistant.types.js';

// Phase 7 — conversational assistant. READ + explain only. The model may call
// ONE read-only tool (query_report); its arguments are re-validated by
// ai-validation.service (the same gate as the NL→query endpoint) before they
// ever reach ReportsService, and there is no mutating tool at all. Threads are
// per-user and every read/write is scoped by userId. The AiRequestLog stays
// content-free (rule #4); the conversation itself lives in the owner-only
// chat tables.

const CHAT_TEMPERATURE = 0.3;
const CHAT_MAX_TOKENS = 1200;
const TITLE_MAX = 60;
const SUMMARY_LIMIT = 160;

/** The authenticated caller with their role — needed to resolve tool permissions. */
export interface ChatCaller {
  id: string;
  role: string;
}

export interface AiChatServiceDeps {
  settings: AiSettingsService;
  budget: AiBudgetService;
  repo: AiAssistantRepository;
  audit: AuditService;
  reports: ReportsService;
  validation: AiValidationService;
  // Optional write-tool wiring. When both are present AND the caller's role is
  // known, the chat model may also PROPOSE write tools (create_*, update_app_settings)
  // — routed through the shared confirm→execute lifecycle. When absent, the chat
  // stays read-only (query_report only), which is exactly the Phase-7 behavior.
  executor?: AiToolExecutorService;
  confirmation?: AiToolConfirmationService;
}

export class AiChatService {
  constructor(private readonly deps: AiChatServiceDeps) {}

  // ---------- reads (owner-scoped; the user's own data) ----------

  async listThreads(actor: AuditActor): Promise<ChatThreadSummaryDto[]> {
    const rows = await this.deps.repo.listThreads(requireUserId(actor));
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async getThread(threadId: string, actor: AuditActor): Promise<ChatThreadDto> {
    const thread = await this.deps.repo.findThreadForUser(threadId, requireUserId(actor));
    if (!thread) throw new NotFoundError('ChatThread', 'CHAT_THREAD_NOT_FOUND');
    return {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      messages: thread.messages.filter((m) => m.role !== 'tool').map(toMessageDto),
    };
  }

  async deleteThread(threadId: string, actor: AuditActor): Promise<void> {
    const count = await this.deps.repo.deleteThreadForUser(threadId, requireUserId(actor));
    if (count === 0) throw new NotFoundError('ChatThread', 'CHAT_THREAD_NOT_FOUND');
  }

  // ---------- send (gated by the chat feature + key + budget) ----------

  async send(
    text: string,
    threadId: string | null,
    actor: AuditActor,
    caller?: ChatCaller,
  ): Promise<ChatSendResult> {
    const { provider, config } = await this.deps.settings.requireProviderForFeature('chat');
    // Chat leans on tool-calling — refuse a model known not to support tools
    // (clear error instead of a vague provider failure). Fails open if unknown.
    await this.deps.settings.assertModelSupportsTools(config.modelDefault);
    await this.deps.budget.assertWithinBudget();
    const userId = requireUserId(actor);

    // Write tools are offered only when the lifecycle is wired AND we know the
    // caller's role (to resolve their permissions). Otherwise chat is read-only.
    const writeCapable = Boolean(this.deps.executor && this.deps.confirmation && caller);
    const toolDefs: AiToolDefinition[] = writeCapable
      ? [CHAT_QUERY_TOOL, ...writeToolDefinitions()]
      : [CHAT_QUERY_TOOL];

    // Resolve the thread (owner-scoped) or open a new one.
    let title: string;
    let history: AiChatMessage[] = [];
    if (threadId) {
      const thread = await this.deps.repo.findThreadForUser(threadId, userId);
      if (!thread) throw new NotFoundError('ChatThread', 'CHAT_THREAD_NOT_FOUND');
      title = thread.title;
      history = thread.messages;
    } else {
      const created = await this.deps.repo.createThread({ userId, title: deriveTitle(text) });
      threadId = created.id;
      title = created.title;
    }

    const messages: AiMessage[] = [
      { role: 'system', content: chatSystemPrompt(todayIso()) },
      ...history.filter((m) => m.role === 'user' || m.role === 'assistant').map(toAiMessage),
      { role: 'user', content: text },
    ];

    const usage = { prompt: 0, completion: 0 };
    let modelUsed = config.modelDefault;

    // Round 1 — the model may answer directly, call the read-only report tool,
    // or (when write-capable) call a write tool that becomes a pending action.
    const first = await provider.complete({
      model: config.modelDefault,
      messages,
      temperature: CHAT_TEMPERATURE,
      maxTokens: CHAT_MAX_TOKENS,
      tools: toolDefs,
      toolChoice: 'auto',
    });
    accumulate(usage, first);
    modelUsed = first.modelUsed;

    let answer = first.content;
    let toolReportType: string | undefined;
    let toolResultForStore: unknown;
    const pendingActions: PendingActionDto[] = [];

    if (first.toolCalls && first.toolCalls.length > 0) {
      // A write tool needs a permission-scoped actor; resolve it once, lazily.
      let toolActor: ToolActor | null = null;
      // Execute each tool call, collect results (reads run now; writes propose).
      const toolMessages: AiMessage[] = [];
      for (const call of first.toolCalls) {
        let content: string;
        if (call.name === CHAT_QUERY_TOOL_NAME) {
          const r = await this.runQueryTool(call.name, call.argumentsJson);
          content = r.content;
          if (r.reportType && !toolReportType) {
            toolReportType = r.reportType;
            toolResultForStore = safeParse(r.content);
          }
        } else if (writeCapable) {
          toolActor ??= await this.deps.executor!.resolveActor(caller!, actor);
          content = await this.proposeWriteTool(call.name, call.argumentsJson, toolActor, pendingActions);
        } else {
          content = JSON.stringify({ error: 'unknown tool', code: 'AI_TOOL_UNKNOWN' });
        }
        toolMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }

      // Round 2 — compose the final answer from the tool results (no more tools).
      const second = await provider.complete({
        model: config.modelDefault,
        messages: [
          ...messages,
          { role: 'assistant', content: first.content, toolCalls: first.toolCalls },
          ...toolMessages,
        ],
        temperature: CHAT_TEMPERATURE,
        maxTokens: CHAT_MAX_TOKENS,
        toolChoice: 'none',
      });
      accumulate(usage, second);
      modelUsed = second.modelUsed;
      answer = second.content;
    }

    if (!answer || answer.trim().length === 0) {
      answer = pendingActions.length
        ? 'جهّزت العملية للمراجعة. راجع التفاصيل ثم اضغط تأكيد للمتابعة.'
        : 'تعذّر توليد رد. حاول إعادة صياغة سؤالك.';
    }

    // Persist the turn: one user row + one assistant row (final answer, with
    // read-only tool metadata for display/audit). No intermediate tool rows.
    await this.deps.repo.createMessage({ threadId, role: 'user', content: text });
    const assistantRow = await this.deps.repo.createMessage({
      threadId,
      role: 'assistant',
      content: answer,
      ...(toolReportType ? { toolCalls: { tool: CHAT_QUERY_TOOL_NAME, reportType: toolReportType } } : {}),
      ...(toolResultForStore !== undefined ? { toolResult: toolResultForStore as object } : {}),
    });
    await this.deps.repo.touchThread(threadId);

    // Governance: content-free summary only. Each proposed write ALSO records
    // its own AI_TOOL_PROPOSED audit event inside the confirmation service.
    await this.logGovernance(actor, {
      modelUsed,
      usage,
      toolReportType,
      proposed: pendingActions.length,
      sourceModules: toolReportType ? ['reports'] : [],
    });

    return { threadId, title, message: toMessageDto(assistantRow), pendingActions };
  }

  /**
   * Route a write tool call into the shared confirm→execute lifecycle: PROPOSE
   * only (validate + preview + persist PENDING). NEVER executes here. Any
   * problem (unknown tool, bad args, missing permission) becomes a tool-result
   * error string the model apologises for — it never throws to the user.
   */
  private async proposeWriteTool(
    name: string,
    argumentsJson: string,
    actor: ToolActor,
    pendingActions: PendingActionDto[],
  ): Promise<string> {
    if (!isRegisteredTool(name)) {
      return JSON.stringify({ error: 'أداة غير مدعومة', code: 'AI_TOOL_UNKNOWN' });
    }
    const tool = getTool(name)!;
    // Chat offers only write tools alongside query_report; a read-only registry
    // tool (generate_report) is not on the chat menu — reject it cleanly.
    if (!tool.requiresConfirmation) {
      return JSON.stringify({ error: 'استخدم query_report للتقارير', code: 'AI_TOOL_UNSUPPORTED' });
    }
    let args: unknown;
    try {
      args = JSON.parse(extractJsonObject(argumentsJson));
    } catch {
      return JSON.stringify({ error: 'وسائط غير صالحة', code: 'AI_TOOL_BAD_ARGS' });
    }
    try {
      // propose() re-checks the tool's permissions, validates, previews, and
      // persists a PENDING action — it does not execute.
      const pending = await this.deps.confirmation!.propose(name, args, actor);
      pendingActions.push(pending);
      return JSON.stringify({
        status: 'pending_confirmation',
        actionId: pending.actionId,
        title: pending.title,
      });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_TOOL_FAILED';
      const message = err instanceof AppError ? err.message : 'تعذّرت العملية';
      return JSON.stringify({ error: message, code });
    }
  }

  // ---------- private ----------

  /**
   * Execute one tool call. Only `query_report` exists; its args are parsed and
   * re-validated by the security gate before execution. Any problem returns a
   * tool-result error string (the model apologises) — never throws to the user.
   */
  private async runQueryTool(
    name: string,
    argumentsJson: string,
  ): Promise<{ content: string; reportType?: string }> {
    if (name !== CHAT_QUERY_TOOL_NAME) {
      return { content: JSON.stringify({ error: 'unknown tool' }) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(argumentsJson));
    } catch {
      return { content: JSON.stringify({ error: 'invalid tool arguments' }) };
    }
    try {
      // THE gate — rejects anything outside the closed report whitelist.
      const query = this.deps.validation.validateQuery(parsed);
      const result = await executeConstrainedReportQuery(this.deps.reports, query);
      return { content: JSON.stringify(result), reportType: query.reportType };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'QUERY_FAILED';
      return { content: JSON.stringify({ error: 'query not allowed or failed', code }) };
    }
  }

  private async logGovernance(
    actor: AuditActor,
    input: {
      modelUsed: string;
      usage: { prompt: number; completion: number };
      toolReportType?: string;
      proposed?: number;
      sourceModules: string[];
    },
  ): Promise<void> {
    const summary = input.toolReportType
      ? `chat: query ${input.toolReportType}`
      : input.proposed
        ? `chat: ${input.proposed} proposed`
        : 'chat: conversation';
    const log = await this.deps.repo.createRequestLog({
      userId: requireUserId(actor),
      operationType: 'CHAT',
      modelUsed: input.modelUsed,
      sourceModules: input.sourceModules,
      recordIds: [],
      tokensPrompt: input.usage.prompt,
      tokensCompletion: input.usage.completion,
      outputSummary: summary.slice(0, SUMMARY_LIMIT),
    });
    await this.deps.audit.log(actor, {
      action: 'CREATE',
      entity: 'AiRequestLog',
      entityId: log.id,
      newValues: {
        operationType: 'CHAT',
        modelUsed: input.modelUsed,
        tokensPrompt: input.usage.prompt,
        tokensCompletion: input.usage.completion,
        toolUsed: input.toolReportType ?? null,
      },
    });
  }
}

// ---------- pure helpers ----------

/** The WRITE tools the chat model may propose (create_*, update_app_settings),
 *  in the OpenRouter wire shape. Reads stay on the closed query_report tool, so
 *  the read-only generate_report tool is intentionally excluded here. */
function writeToolDefinitions(): AiToolDefinition[] {
  return listTools()
    .filter((tool) => tool.requiresConfirmation)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }));
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= TITLE_MAX ? t : `${t.slice(0, TITLE_MAX - 1)}…`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toAiMessage(m: AiChatMessage): AiMessage {
  return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
}

function toMessageDto(m: AiChatMessage): ChatMessageDto {
  const toolMeta = m.toolCalls as { reportType?: string } | null;
  return {
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    ...(toolMeta?.reportType ? { toolReportType: toolMeta.reportType } : {}),
    createdAt: m.createdAt.toISOString(),
  };
}

function accumulate(usage: { prompt: number; completion: number }, r: AiCompletionResult): void {
  usage.prompt += r.usage.promptTokens;
  usage.completion += r.usage.completionTokens;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
