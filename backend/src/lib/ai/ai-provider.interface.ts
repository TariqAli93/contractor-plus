/**
 * Provider abstraction for AI completions. OpenRouter is the ONLY
 * implementation in this batch (openrouter.provider.ts); the interface exists
 * for testability (mock providers in unit tests), not multi-provider support.
 */

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A tool call the model wants executed (Phase 7 — read-only tools only). */
export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the arguments — validated before ever being used. */
  argumentsJson: string;
}

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  /** assistant turns that requested tools. */
  toolCalls?: AiToolCall[];
  /** tool-role turns: which call this message answers, and the tool name. */
  toolCallId?: string;
  name?: string;
}

/** A tool the model MAY call. `parameters` is a JSON Schema object. */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiCompletionInput {
  /** OpenRouter model slug — always sourced from env config, never a literal. */
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * 'json_object' asks the provider for structured JSON output. Callers must
   * ALSO instruct the model in the system prompt to answer with JSON only.
   */
  responseFormat?: 'json_object';
  /** Tools the model may call (Phase 7). */
  tools?: AiToolDefinition[];
  /** 'auto' lets the model decide; 'none' forbids tools this turn. */
  toolChoice?: 'auto' | 'none';
}

/** Token usage as reported by the provider's `usage` block. */
export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AiCompletionResult {
  /** The assistant message content (single choice); '' when only tools are called. */
  content: string;
  /** Tool calls the model requested this turn, if any. */
  toolCalls?: AiToolCall[];
  /** Model slug the provider actually served (echoed from the response). */
  modelUsed: string;
  usage: AiUsage;
}

export interface AiProvider {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
