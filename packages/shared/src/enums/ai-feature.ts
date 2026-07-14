/**
 * The closed set of togglable AI features (Phase 2.5). Every AI capability
 * passes through the central `isFeatureEnabled(feature)` gate before it runs.
 * `chat` is reserved for a later phase — no chat feature exists yet.
 */
export const AiFeature = {
  REPORT_NARRATIVE: 'report_narrative',
  NL_QUERY: 'nl_query',
  SAVE_GUARD: 'save_guard',
  RECOMMENDATIONS: 'recommendations',
  CHAT: 'chat',
} as const;
export type AiFeature = (typeof AiFeature)[keyof typeof AiFeature];

export const AI_FEATURES: AiFeature[] = Object.values(AiFeature);
