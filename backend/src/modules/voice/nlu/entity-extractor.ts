// ============================================================
// Entity extractor — pulls typed slots out of an utterance.
//
// Pure + dependency-free (operates on tokens), so it is fully unit-testable and
// shared by any NLU provider. Strategy: scan tokens for unit/marker keywords
// ("متر", "مساحه", "واجهه", "نزال", "باسم", …) and bind the nearest number or
// the following name span. Proper names are returned with their ORIGINAL
// spelling (we never hand back the normalised, hamza-stripped form for a name).
//
// A leading "و" (and) is frequently glued to the next word in dictated Arabic
// ("ونزال", "وعشرين"); marker/number lookups therefore also try the de-waw'd
// form, but only as a fallback so legitimately-waw-initial words ("واجهة")
// still match directly.
// ============================================================

import {
  EntityType,
  ProjectType,
  type EntityBag,
  type ExtractedEntity,
} from '@contractor-plus/shared';
import { NAME_STOPWORDS, PROJECT_TYPE_MAP, ROUTE_MAP } from './arabic-lexicon.js';
import { deWaw, parseNumberToken, tokenize, type Token } from './normalize.js';

const AREA_MARKERS = new Set(['متر', 'م2', 'م²', 'مساحه', 'مساحته', 'بمساحه', 'مترمربع']);
const FRONTAGE_MARKERS = new Set(['واجهه', 'واجهته', 'الواجهه']);
const DEPTH_MARKERS = new Set(['نزال', 'النزال', 'عمق', 'العمق', 'نزاله']);
const FLOOR_MARKERS = new Set(['طابق', 'طوابق', 'طابقين', 'طوابقها', 'الطوابق']);
const MONEY_MARKERS = new Set([
  'دينار',
  'مبلغ',
  'بمبلغ',
  'دولار',
  'كلفته',
  'بقيمه',
  'قيمته',
  'تكلفه',
  'كلفه',
  'دفعه',
  'قسط',
]);
const METER_PRICE_MARKERS = new Set(['سعر', 'بسعر', 'سعرالمتر', 'السعر']);
const NAME_MARKERS = new Set(['باسم', 'اسمه', 'باسمه', 'صاحبه', 'للعميل', 'العميل']);
const REF_TOKENS = new Set(['نفس', 'هذا', 'هاذا', 'الاخير', 'السابق', 'اخر', 'الحالي']);
// Verbs/markers that signal a spoken amount even without a unit ("استلم مليون").
const MONEY_CONTEXT = new Set([
  'استلم',
  'استلمت',
  'دفع',
  'دفعت',
  'ادفع',
  'سدد',
  'سددت',
  'صرف',
  'صرفت',
  'واصل',
  'اشتريت',
  'اشتري',
  'شريت',
  'مبلغ',
  'تسديد',
  'بقيمه',
  'قيمته',
  'كلفته',
]);

// Scale words that MULTIPLY the preceding number ("250 ألف" → 250000).
const SCALE_WORDS: Record<string, number> = {
  الف: 1000,
  الاف: 1000,
  مليون: 1_000_000,
  ملايين: 1_000_000,
  مليار: 1_000_000_000,
};

function inSet(set: Set<string>, norm: string): boolean {
  return set.has(norm) || set.has(deWaw(norm));
}
function mapGet<T>(map: Record<string, T>, norm: string): T | undefined {
  return map[norm] ?? map[deWaw(norm)];
}
function numberOf(norm: string): number | null {
  return parseNumberToken(norm) ?? parseNumberToken(deWaw(norm));
}

function findNumberNear(tokens: Token[], idx: number): { value: number; raw: string } | null {
  for (const j of [idx + 1, idx - 1, idx + 2]) {
    const tk = tokens[j];
    if (!tk) continue;
    const n = numberOf(tk.norm);
    if (n !== null) return { value: n, raw: tk.original };
  }
  return null;
}

/** Like findNumberNear but applies a trailing scale word ("250 ألف" → 250000). */
function findMoneyNear(tokens: Token[], idx: number): { value: number; raw: string } | null {
  for (const j of [idx + 1, idx - 1, idx + 2, idx + 3]) {
    const tk = tokens[j];
    if (!tk) continue;
    const n = numberOf(tk.norm);
    if (n === null) continue;
    const next = tokens[j + 1];
    const scale = next ? SCALE_WORDS[deWaw(next.norm)] : undefined;
    if (scale) return { value: n * scale, raw: `${tk.original} ${next!.original}` };
    return { value: n, raw: tk.original };
  }
  return null;
}

/** First scaled money amount anywhere in a bare answer ("250 ألف" → 250000). */
export function firstScaledMoney(text: string): number | null {
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const n = numberOf(toks[i]!.norm);
    if (n === null) continue;
    const next = toks[i + 1];
    const scale = next ? SCALE_WORDS[deWaw(next.norm)] : undefined;
    return scale ? n * scale : n;
  }
  return null;
}

/** First plain number anywhere in a bare answer ("مساحته 200" / "200" → 200). */
export function firstNumber(text: string): number | null {
  for (const t of tokenize(text)) {
    const n = numberOf(t.norm);
    if (n !== null) return n;
  }
  return null;
}

function captureName(tokens: Token[], markerIdx: number): { value: string } | null {
  const parts: string[] = [];
  for (let j = markerIdx + 1; j < tokens.length && parts.length < 4; j++) {
    const t = tokens[j];
    if (!t) break;
    if (inSet(NAME_STOPWORDS, t.norm)) break;
    if (numberOf(t.norm) !== null) break;
    parts.push(t.original);
  }
  if (parts.length === 0) return null;
  return { value: parts.join(' ') };
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  bag: EntityBag;
}

export function extractEntities(transcript: string): ExtractionResult {
  const tokens = tokenize(transcript);
  const entities: ExtractedEntity[] = [];
  const bag: EntityBag = {};

  const push = <T,>(type: EntityType, value: T, raw: string, confidence = 0.9): void => {
    entities.push({ type, value, raw, confidence });
  };
  const bindNumber = (i: number, type: EntityType, assign: (n: number) => void): void => {
    const hit = findNumberNear(tokens, i);
    if (hit) {
      assign(hit.value);
      push(type, hit.value, hit.raw);
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const norm = tok.norm;

    const pt = mapGet(PROJECT_TYPE_MAP, norm);
    if (pt && bag.projectType === undefined) {
      bag.projectType = pt as ProjectType;
      push(EntityType.PROJECT_TYPE, pt, tok.original, 0.95);
      // "بيت 100" — a bare number right after the type reads as the area.
      const next = tokens[i + 1];
      if (next && bag.area === undefined) {
        const n = numberOf(next.norm);
        if (n !== null) {
          bag.area = n;
          push(EntityType.AREA, n, next.original, 0.7);
        }
      }
      continue;
    }

    if (inSet(AREA_MARKERS, norm) && bag.area === undefined) {
      bindNumber(i, EntityType.AREA, (n) => (bag.area = n));
      continue;
    }
    if (inSet(FRONTAGE_MARKERS, norm) && bag.frontage === undefined) {
      bindNumber(i, EntityType.FRONTAGE, (n) => (bag.frontage = n));
      continue;
    }
    if (inSet(DEPTH_MARKERS, norm) && bag.depth === undefined) {
      bindNumber(i, EntityType.DEPTH, (n) => (bag.depth = n));
      continue;
    }
    if (inSet(FLOOR_MARKERS, norm) && bag.floors === undefined) {
      if (deWaw(norm) === 'طابقين') {
        bag.floors = 2;
        push(EntityType.FLOORS, 2, tok.original);
      } else {
        bindNumber(i, EntityType.FLOORS, (n) => (bag.floors = n));
      }
      continue;
    }
    // meter price ("سعر المتر 250 ألف") — checked before generic money.
    if (inSet(METER_PRICE_MARKERS, norm) && bag.meterPrice === undefined) {
      const hit = findMoneyNear(tokens, i);
      if (hit) {
        bag.meterPrice = hit.value;
        push(EntityType.METER_PRICE, hit.value, hit.raw, 0.85);
      }
      continue;
    }

    if (inSet(MONEY_MARKERS, norm) && bag.money === undefined) {
      const hit = findMoneyNear(tokens, i);
      if (hit) {
        bag.money = hit.value;
        push(EntityType.MONEY, hit.value, hit.raw, 0.8);
      }
      continue;
    }

    if (inSet(NAME_MARKERS, norm) && bag.customerName === undefined) {
      const name = captureName(tokens, i);
      if (name) {
        bag.customerName = name.value;
        push(EntityType.CUSTOMER_NAME, name.value, name.value, 0.85);
      }
      if (deWaw(norm) === 'اسمه' || deWaw(norm) === 'باسمه') {
        bag.entityRef = 'last_customer';
        push(EntityType.ENTITY_REF, 'last_customer', tok.original, 0.7);
      }
      continue;
    }

    if (inSet(REF_TOKENS, norm) && bag.entityRef === undefined) {
      bag.entityRef = deWaw(norm);
      push(EntityType.ENTITY_REF, deWaw(norm), tok.original, 0.7);
      continue;
    }

    const route = mapGet(ROUTE_MAP, norm);
    if (route && bag.route === undefined) {
      bag.route = route;
      push(EntityType.ROUTE, route, tok.original, 0.9);
      continue;
    }
  }

  // Contract reference: "رقم V-2026-0004" or a bare code-like token.
  if (bag.contractRef === undefined) {
    for (let i = 0; i < tokens.length; i++) {
      if (deWaw(tokens[i]!.norm) === 'رقم') {
        const next = tokens[i + 1];
        if (next) {
          bag.contractRef = next.original;
          push(EntityType.CONTRACT_REF, next.original, next.original, 0.85);
          break;
        }
      }
    }
    if (bag.contractRef === undefined) {
      const code = tokens.find((t) => t.norm.includes('-') && /\d/.test(t.norm));
      if (code) {
        bag.contractRef = code.original;
        push(EntityType.CONTRACT_REF, code.original, code.original, 0.8);
      }
    }
  }

  // Money-context capture: a bare amount next to a money verb ("استلم مليون",
  // "دفع الزبون مليونين", "اشتريت حديد بقيمة 5 ملايين") becomes `money` even
  // without a unit marker.
  const deWawed = tokens.map((t) => deWaw(t.norm));
  if (bag.money === undefined && deWawed.some((n) => MONEY_CONTEXT.has(n))) {
    const amount = firstScaledMoney(transcript);
    if (amount !== null) {
      bag.money = amount;
      push(EntityType.MONEY, amount, 'مبلغ', 0.75);
    }
  }

  // auto-materials flag: "ضيف المواد …" in an add context.
  const normJoined = deWawed.join(' ');
  if (/(^|\s)(ضيف|اضيف|اضف)(\s|$)/.test(normJoined) && /(^|\s)(المواد|مواد)(\s|$)/.test(normJoined)) {
    bag.autoMaterials = true;
    push(EntityType.AUTO_MATERIALS, true, 'المواد المناسبة', 0.8);
  }

  return { entities, bag };
}
