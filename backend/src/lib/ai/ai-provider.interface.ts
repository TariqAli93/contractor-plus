/**
 * Provider abstraction for AI completions. OpenRouter is the ONLY
 * implementation in this batch (openrouter.provider.ts); the interface exists
 * for testability (mock providers in unit tests), not multi-provider support.
 */

export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
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
}

/** Token usage as reported by the provider's `usage` block. */
export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AiCompletionResult {
  /** The assistant message content (single choice). */
  content: string;
  /** Model slug the provider actually served (echoed from the response). */
  modelUsed: string;
  usage: AiUsage;
}

export interface AiProvider {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
