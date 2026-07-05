// ============================================================
// Voice intents — the stable, provider-agnostic vocabulary of
// "what the user wants to do". These names are a CONTRACT shared by
// the backend NLU engine and the frontend assistant. They never carry
// surface text — recognising "سويلي مشروع" vs "أنشئ مشروع" is the NLU
// provider's job; both resolve to the same intent name here.
//
// Adding a new intent = add a name here + register a handler on the
// backend. No core change. (Open/Closed.)
// ============================================================

export const VoiceIntent = {
  // ---- server intents (mutate or read domain data) ----
  CREATE_PROJECT: 'create_project',
  CREATE_CONTRACT: 'create_contract',
  ADD_COST: 'add_cost',
  ADD_PAYMENT: 'add_payment',
  ADD_MATERIALS: 'add_materials',
  UPDATE_PROJECT: 'update_project',
  LINK_PROJECT_CONTRACT: 'link_project_to_contract',

  // ---- client intents (navigation / UI only, no DB write) ----
  NAVIGATE: 'navigate',
  OPEN_ENTITY: 'open_entity',
  SEARCH: 'search',

  // ---- meta intents (handled by the dialog loop itself) ----
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  HELP: 'help',
  UNKNOWN: 'unknown',
} as const;

export type VoiceIntent = (typeof VoiceIntent)[keyof typeof VoiceIntent];

export const VOICE_INTENTS: VoiceIntent[] = Object.values(VoiceIntent);

/** Whether an intent is executed by the backend domain layer (vs. a pure UI action). */
export function isServerIntent(intent: VoiceIntent): boolean {
  return (
    intent === VoiceIntent.CREATE_PROJECT ||
    intent === VoiceIntent.CREATE_CONTRACT ||
    intent === VoiceIntent.ADD_COST ||
    intent === VoiceIntent.ADD_PAYMENT ||
    intent === VoiceIntent.ADD_MATERIALS ||
    intent === VoiceIntent.UPDATE_PROJECT ||
    intent === VoiceIntent.LINK_PROJECT_CONTRACT
  );
}
