/**
 * OpenRouter model list — shared shapes and PURE classification helpers.
 *
 * There is deliberately NO hardcoded list of models here: the catalogue is
 * fetched live from OpenRouter for the current key (see the backend
 * openrouter-models service). This file holds only the DTO the API returns to
 * the SPA and the small, provider-agnostic helpers used to build it.
 */

/** One selectable OpenRouter model, as surfaced to the control panel. */
export interface AiModelListItem {
  /** Full OpenRouter slug, e.g. `google/gemini-2.5-flash` — used verbatim in chat completions. */
  id: string;
  /** Raw catalogue name from OpenRouter. */
  name: string;
  /** Derived from the slug's first segment — NEVER a hardcoded provider. */
  provider: string;
  /** Human label for the dropdown (falls back to the slug when name is empty). */
  displayName: string;
  description?: string;
  /** true ⇒ show a "مجاني" badge; computed by the backend, trusted by the UI. */
  isFree: boolean;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
}

/**
 * A price is "zero" (free-tier signal) when it is absent, empty, or parses to
 * exactly 0. OpenRouter sends prices as strings ("0", "0.0000015") OR numbers —
 * both are handled here (binding: never assume the wire type).
 */
export function isZeroPrice(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

/** The provider segment of a slug (`anthropic/claude-x` → `anthropic`). */
export function deriveModelProvider(id: string): string {
  const head = id.split('/')[0]?.trim();
  return head && head.length > 0 ? head : 'other';
}

/**
 * A model id that OpenRouter marks as free by convention: the `:free` suffix
 * or the special `openrouter/free` slug. (Zero pricing is the other signal,
 * evaluated by the caller which has the price fields.)
 */
export function isFreeModelId(id: string): boolean {
  return id.endsWith(':free') || id === 'openrouter/free';
}
