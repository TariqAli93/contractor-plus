// ============================================================
// search handler — a CLIENT intent that opens the global command palette.
//
//   "ابحث عن أحمد"         → open the palette pre-filled with "أحمد"
//   "دور على مشروع الفلة"   → open the palette pre-filled with "الفلة"
//
// The palette already runs a live cross-entity search (projects / contracts /
// customers / materials), so SEARCH just hands it the spoken query. Pure: no DB
// read, no mutation, no confirmation. A query we can't parse still opens the
// palette (empty) so the user can type — never a dead end.
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import type { ClientAction } from '@contractor-plus/shared';
import { deWaw, tokenize } from '../../nlu/normalize.js';
import type { IntentHandler, Plan, PlanInput, SlotDef } from '../voice.types.js';

const SEARCH_VERBS = new Set(['ابحث', 'دور', 'فتش', 'بحث', 'لكيلي', 'بحثلي', 'دورلي', 'لكي']);
const PREPS = new Set(['عن', 'علي', 'ب', 'بال']);
const TYPE_NOUNS = new Set([
  'مشروع',
  'المشروع',
  'عقد',
  'العقد',
  'عميل',
  'العميل',
  'زبون',
  'الزبون',
  'ماده',
  'مادة',
  'المواد',
  'مواد',
]);

export class SearchHandler implements IntentHandler {
  readonly intent = VoiceIntent.SEARCH;
  readonly requiredSlots: SlotDef[] = [];

  plan(input: PlanInput): Plan {
    const query = parseQuery(input.transcript);
    const action: ClientAction = query
      ? { type: 'open_palette', query }
      : { type: 'open_palette' };
    return {
      intent: this.intent,
      side: 'client',
      mutates: false,
      requiredPermissions: [],
      steps: [],
      clientActions: [action],
      summary: {
        title: 'بحث',
        mutates: false,
        lines: [{ label: 'البحث عن', value: query || '—' }],
      },
    };
  }

  summarize(): string {
    return 'بحث';
  }
}

/** Extract the search term: drop the verb, a following preposition, and an
 *  entity-type noun ("ابحث عن مشروع الفلة" → "الفلة"). */
function parseQuery(transcript: string): string {
  const tokens = tokenize(transcript);
  let start = 0;
  const verbIdx = tokens.findIndex((tk) => SEARCH_VERBS.has(deWaw(tk.norm)));
  if (verbIdx >= 0) {
    start = verbIdx + 1;
    if (tokens[start] && PREPS.has(deWaw(tokens[start]!.norm))) start++;
    if (tokens[start] && TYPE_NOUNS.has(deWaw(tokens[start]!.norm))) start++;
  }
  const parts: string[] = [];
  for (let j = start; j < tokens.length && parts.length < 6; j++) {
    parts.push(tokens[j]!.original);
  }
  return parts.join(' ').trim();
}
