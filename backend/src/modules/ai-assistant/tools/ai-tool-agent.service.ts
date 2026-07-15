import { AppError } from '../../../shared/errors/app-error.js';
import { extractJsonObject } from '../../../lib/ai/extract-json.js';
import type { AiCompletionResult, AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiSettingsService } from '../services/ai-settings.service.js';
import type { AiBudgetService } from '../services/ai-budget.service.js';
import { getTool, isRegisteredTool, toolDefinitionsForProvider } from './ai-tool.registry.js';
import type { AiToolExecutorService } from './ai-tool-executor.service.js';
import type { AiToolConfirmationService } from './ai-tool-confirmation.service.js';
import type { AgentTurnResult, PendingActionDto, ToolActor, ToolResultDto } from './ai-tool.types.js';

const MAX_TOOL_CYCLES = 5; // حد أقصى لدورات الأدوات لمنع الحلقات اللانهائية.
const TEMPERATURE = 0.3;
const MAX_TOKENS = 1200;

const SYSTEM_PROMPT = [
  'أنت مساعد ذكي داخل نظام إدارة مقاولات. يمكنك تنفيذ عمليات عبر الأدوات المتاحة فقط.',
  'لا تخترع بيانات. استخدم أداة واحدة مناسبة لكل طلب.',
  'عمليات الإنشاء والتعديل (create_*, update_*) لا تُنفَّذ مباشرة: تُقترَح وتنتظر تأكيد المستخدم صراحةً.',
  'أداة generate_report للقراءة فقط. أجب دائمًا بالعربية بإيجاز.',
].join(' ');

export interface AiToolAgentDeps {
  settings: AiSettingsService;
  budget: AiBudgetService;
  aiRepo: AiAssistantRepository;
  audit: AuditService;
  executor: AiToolExecutorService;
  confirmation: AiToolConfirmationService;
}

// The single-turn tool-calling orchestrator behind POST /ai/actions/message.
// The model may call read tools (executed inline) and write tools (PROPOSED
// only — each becomes its own pending action requiring a separate confirm). It
// NEVER acts on the model's free text: execution flows only from a tool_call
// that matches a registered tool.
export class AiToolAgentService {
  constructor(private readonly deps: AiToolAgentDeps) {}

  async run(text: string, actor: ToolActor): Promise<AgentTurnResult> {
    const { provider, config } = await this.deps.settings.requireProviderForFeature('chat');
    await this.deps.settings.assertModelSupportsTools(config.modelDefault);
    await this.deps.budget.assertWithinBudget();

    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ];
    const toolDefs = toolDefinitionsForProvider();
    const pendingActions: PendingActionDto[] = [];
    const toolResults: ToolResultDto[] = [];
    const usage = { prompt: 0, completion: 0 };
    let modelUsed = config.modelDefault;
    let finalContent = '';

    for (let cycle = 0; cycle < MAX_TOOL_CYCLES; cycle++) {
      const res: AiCompletionResult = await provider.complete({
        model: config.modelDefault,
        messages,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        tools: toolDefs,
        toolChoice: 'auto',
      });
      usage.prompt += res.usage.promptTokens;
      usage.completion += res.usage.completionTokens;
      modelUsed = res.modelUsed;

      if (!res.toolCalls || res.toolCalls.length === 0) {
        finalContent = res.content;
        break;
      }

      messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const content = await this.handleCall(call.name, call.argumentsJson, actor, pendingActions, toolResults);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
    }

    // No plain answer yet (the model only called tools) → one final text turn.
    if (!finalContent || finalContent.trim().length === 0) {
      const closing = await provider.complete({
        model: config.modelDefault,
        messages,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        toolChoice: 'none',
      });
      usage.prompt += closing.usage.promptTokens;
      usage.completion += closing.usage.completionTokens;
      modelUsed = closing.modelUsed;
      finalContent = closing.content;
    }
    if (!finalContent || finalContent.trim().length === 0) {
      finalContent = pendingActions.length
        ? 'جهّزت العملية للمراجعة. اضغط تأكيد للمتابعة.'
        : 'تعذّر توليد رد. أعد صياغة طلبك.';
    }

    await this.logGovernance(actor.audit, {
      modelUsed,
      usage,
      providerRequestId: undefined,
      proposed: pendingActions.length,
      reads: toolResults.length,
    });

    return { message: finalContent, pendingActions, toolResults };
  }

  /** Execute a read tool inline, or PROPOSE a write tool. Never throws to the
   *  loop — a problem becomes a tool-result error the model apologises for. */
  private async handleCall(
    name: string,
    argumentsJson: string,
    actor: ToolActor,
    pendingActions: PendingActionDto[],
    toolResults: ToolResultDto[],
  ): Promise<string> {
    if (!isRegisteredTool(name)) {
      return JSON.stringify({ error: 'أداة غير مدعومة', code: 'AI_TOOL_UNKNOWN' });
    }
    let args: unknown;
    try {
      args = JSON.parse(extractJsonObject(argumentsJson));
    } catch {
      return JSON.stringify({ error: 'وسائط غير صالحة', code: 'AI_TOOL_BAD_ARGS' });
    }
    const tool = getTool(name)!;
    try {
      this.deps.executor.ensurePermissions(tool, actor);
    } catch {
      return JSON.stringify({ error: 'لا تملك صلاحية هذه العملية', code: 'AI_TOOL_FORBIDDEN' });
    }

    try {
      if (tool.requiresConfirmation) {
        const pending = await this.deps.confirmation.propose(name, args, actor);
        pendingActions.push(pending);
        return JSON.stringify({
          status: 'pending_confirmation',
          actionId: pending.actionId,
          title: pending.title,
        });
      }
      // Read-only tool — run now and feed the result back to the model.
      const ctx = this.deps.executor.buildContext(actor);
      const validated = await this.deps.executor.validate(tool, args, ctx);
      const result = await this.deps.executor.execute(tool, validated, ctx);
      const safe = tool.sanitizeResult(result);
      toolResults.push({ toolName: tool.name, module: result.module, summary: result.summary, data: safe });
      return JSON.stringify(safe).slice(0, 4000);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_TOOL_FAILED';
      const message = err instanceof AppError ? err.message : 'تعذّرت العملية';
      return JSON.stringify({ error: message, code });
    }
  }

  private async logGovernance(
    actor: AuditActor,
    input: {
      modelUsed: string;
      usage: { prompt: number; completion: number };
      providerRequestId?: string;
      proposed: number;
      reads: number;
    },
  ): Promise<void> {
    const log = await this.deps.aiRepo.createRequestLog({
      userId: requireUserId(actor),
      operationType: 'TOOL_ACTION',
      modelUsed: input.modelUsed,
      sourceModules: [],
      recordIds: [],
      tokensPrompt: input.usage.prompt,
      tokensCompletion: input.usage.completion,
      outputSummary: `tools: ${input.proposed} مقترحة، ${input.reads} قراءة`.slice(0, 160),
    });
    await this.deps.audit.log(actor, {
      action: 'CREATE',
      entity: 'AiRequestLog',
      entityId: log.id,
      newValues: {
        operationType: 'TOOL_ACTION',
        modelUsed: input.modelUsed,
        tokensPrompt: input.usage.prompt,
        tokensCompletion: input.usage.completion,
        proposed: input.proposed,
      },
    });
  }
}
