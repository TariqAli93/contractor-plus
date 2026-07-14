/**
 * Allow-list of OpenRouter model slugs the operator may pick from in the AI
 * control panel (Phase 2.5, decision E4). The user never types a free-form
 * slug — a value submitted via PUT /ai/settings must be in this list.
 *
 * IMPORTANT: OpenRouter's catalogue changes over time — keep this list short
 * and curated, and update it (not the calling code) when slugs change. Values
 * supplied through env/service.json are trusted and BYPASS this list, so a
 * locked-down install can pin a model that isn't listed here.
 */
export const AI_MODEL_ALLOWLIST: readonly string[] = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-haiku',
] as const;

/** Is `slug` an operator-selectable model? (env-provided slugs bypass this.) */
export function isAllowedModel(slug: string): boolean {
  return AI_MODEL_ALLOWLIST.includes(slug);
}
