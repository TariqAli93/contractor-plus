// ============================================================
// Guided workflow state — the deterministic, LLM-free half of a multi-turn
// conversation. Today one workflow exists: building an estimation template.
//
// "سوّيلي قالب بيت" is not a command; it is the opening of a conversation. The
// assistant collects what it needs one question at a time and only hands the
// request to the estimation tool once it has enough. Nothing here plans,
// previews, confirms, or executes — and nothing here calls a model, so a
// gathering turn costs the user no quota and no latency.
//
// The brief lives in the session's working state under WORKFLOW_TOOL, and is
// cleared the moment the real tool takes over (the tool then owns its own
// durable draft, and refinement turns continue against that).
// ============================================================

import { normalizeArabic } from '../ai-command-workflow/ai-command-workflow.arabic.js';
import type { PlatformRefOption } from '@contractor-plus/shared';

/** Reserved `activeTool` value — the assistant itself owns the working state.
 *  It is deliberately not a registered tool name, so tool lookup never resolves it. */
export const WORKFLOW_TOOL = 'assistant.workflow';

export type EstimationScope = 'structural' | 'finishing' | 'full';
export type BriefGap = 'area' | 'floors' | 'scope';

export interface EstimationBrief {
  kind: 'estimation_brief';
  /** The user's own opening words, preserved verbatim. */
  request: string;
  area: { value: number; unit: string } | null;
  floors: number | null;
  scope: EstimationScope | null;
  /** The gap the last question asked about — lets a bare "250" or "طابقين" land
   *  in the right slot without guessing. */
  awaiting: BriefGap | null;
}

// These double as the chips offered with the scope question, so each label must
// parse back to its own scope through `readScope` when the user clicks it.
const SCOPE_LABELS: Record<EstimationScope, string> = {
  structural: 'هيكل فقط',
  finishing: 'تشطيب فقط',
  full: 'هيكل وتشطيب كامل',
};

// Linear structures have no storeys — never ask.
const LINEAR_STRUCTURES = ['سياج', 'سور', 'جدار', 'fence', 'wall'].map(normalizeArabic);

const WORD_NUMBERS = new Map<string, number>(
  (
    [
      ['واحد', 1], ['وحده', 1], ['اثنين', 2], ['ثنين', 2], ['اثنان', 2], ['ثلاث', 3], ['ثلاثه', 3],
      ['اربع', 4], ['اربعه', 4], ['خمس', 5], ['خمسه', 5], ['ست', 6], ['سته', 6], ['سبع', 7], ['سبعه', 7],
    ] as Array<[string, number]>
  ).map(([word, n]) => [normalizeArabic(word), n]),
);

/** Arabic-Indic and Eastern-Arabic digits → ASCII, so "٢٥٠" parses as 250. */
function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

function prepare(text: string): string {
  return normalizeArabic(toWesternDigits(text));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function newBrief(request: string): EstimationBrief {
  return { kind: 'estimation_brief', request, area: null, floors: null, scope: null, awaiting: null };
}

/** Read a brief out of a session's working state, or null if it holds something else. */
export function readBrief(workingState: unknown): EstimationBrief | null {
  const s = workingState as Partial<EstimationBrief> | null | undefined;
  return s && s.kind === 'estimation_brief' ? (s as EstimationBrief) : null;
}

// ---------------------------------------------------------------------------
// Extraction — pure, deterministic, Arabic-first
// ---------------------------------------------------------------------------

const AREA_RE = /(\d+(?:[.,]\d+)?)\s*(متر\s*مربع|م\s*2|م²|m2|m²|sqm|متر|m\b)/u;
const FLOORS_RE = /(\d+)\s*(طوابق|طابق)/u;
const BARE_NUMBER_RE = /^\s*(\d+(?:[.,]\d+)?)\s*$/u;

function readArea(norm: string): { value: number; unit: string } | null {
  const m = AREA_RE.exec(norm);
  if (!m) return null;
  const value = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unitWord = m[2]!;
  const squared = /مربع|م\s*2|م²|m2|m²|sqm/u.test(unitWord);
  return { value, unit: squared ? 'متر مربع' : 'متر' };
}

function readFloors(norm: string): number | null {
  // "طابقين" / "طابقان" — the Arabic dual, which carries the number itself.
  if (/طابقين|طابقان/u.test(norm)) return 2;

  const digits = FLOORS_RE.exec(norm);
  if (digits) {
    const n = Number(digits[1]);
    if (Number.isInteger(n) && n > 0 && n < 200) return n;
  }
  // "ثلاث طوابق" / "طابق واحد"
  const words = norm.split(/\s+/);
  const at = words.findIndex((w) => w === 'طوابق' || w === 'طابق');
  if (at !== -1) {
    for (const neighbour of [words[at - 1], words[at + 1]]) {
      const n = neighbour ? WORD_NUMBERS.get(neighbour) : undefined;
      if (n) return n;
    }
    if (/طابق(?!\S)/u.test(norm)) return 1; // a lone "طابق" means one storey
  }
  return null;
}

function readScope(norm: string): EstimationScope | null {
  const structural = /هيكل|عظم|structural/u.test(norm);
  const finishing = /تشطيب|finishing/u.test(norm);
  const whole = /كامل|كامله|الاثنين|كلشي|الكل|full/u.test(norm);
  // The question is "هيكل فقط أم تشطيب كامل؟", so "تشطيب كامل" is the whole
  // package — only a qualified "تشطيب فقط" means finishing on its own.
  if (structural && finishing) return 'full';
  if (finishing) return whole ? 'full' : 'finishing';
  if (structural) return 'structural';
  return whole ? 'full' : null;
}

/** Fold one user message into the brief. Pure — returns a new brief. */
export function applyAnswer(brief: EstimationBrief, text: string): EstimationBrief {
  const norm = prepare(text);
  const next: EstimationBrief = { ...brief };

  if (next.area === null) next.area = readArea(norm);
  if (next.floors === null) next.floors = readFloors(norm);
  if (next.scope === null) next.scope = readScope(norm);

  // A bare number answers whatever we just asked about.
  const bare = BARE_NUMBER_RE.exec(toWesternDigits(text));
  if (bare) {
    const value = Number(bare[1]!.replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      if (brief.awaiting === 'area' && next.area === null) next.area = { value, unit: 'متر مربع' };
      if (brief.awaiting === 'floors' && next.floors === null && Number.isInteger(value)) next.floors = value;
    }
  }
  next.awaiting = null;
  return next;
}

/** The next thing the assistant genuinely needs, or null when it has enough. */
export function nextGap(brief: EstimationBrief): BriefGap | null {
  if (brief.area === null) return 'area';
  const linear = LINEAR_STRUCTURES.some((word) => normalizeArabic(brief.request).includes(word));
  if (!linear && brief.floors === null) return 'floors';
  if (brief.scope === null) return 'scope';
  return null;
}

export interface BriefQuestion {
  question: string;
  missing: string[];
  options?: PlatformRefOption[];
}

/** The Arabic question for a gap. `opening` bundles everything the assistant
 *  needs up front (the natural way to answer "سوّيلي قالب بيت"); later turns ask
 *  one thing at a time and acknowledge the answer that came before. */
export function gapQuestion(gap: BriefGap, opts: { opening: boolean }): BriefQuestion {
  if (opts.opening) {
    return {
      question:
        'أكيد. حتى أسويلك القالب أحتاج أعرف:\n• المساحة (بالمتر المربع)\n• عدد الطوابق\n• نوع البناء: هيكل فقط أم تشطيب كامل',
      missing: ['المساحة', 'عدد الطوابق', 'نوع البناء'],
    };
  }
  if (gap === 'area') return { question: 'كم المساحة بالمتر المربع؟', missing: ['المساحة'] };
  if (gap === 'floors') return { question: 'ممتاز. كم عدد الطوابق؟', missing: ['عدد الطوابق'] };
  return {
    question: 'هيكل فقط أم تشطيب كامل؟',
    missing: ['نوع البناء'],
    options: (Object.keys(SCOPE_LABELS) as EstimationScope[]).map((scope) => ({
      slot: 'scope',
      id: scope,
      label: SCOPE_LABELS[scope],
    })),
  };
}

/** Everything gathered, as one natural-language request for the estimation tool.
 *  The user's own words lead, so nuance ("بيت ريفي بطابقين") is never lost. */
export function composeRequest(brief: EstimationBrief): string {
  const parts = [brief.request.trim()];
  if (brief.area) parts.push(`المساحة: ${brief.area.value} ${brief.area.unit}`);
  if (brief.floors !== null) parts.push(`عدد الطوابق: ${brief.floors}`);
  if (brief.scope) parts.push(`نطاق العمل: ${SCOPE_LABELS[brief.scope]}`);
  return parts.join('. ');
}
