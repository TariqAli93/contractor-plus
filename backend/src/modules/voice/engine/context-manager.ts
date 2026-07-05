// ============================================================
// Context Manager — conversational memory + reference resolution.
//
// Handles المرحلة السابعة (Context Awareness) and المرحلة الحادية عشرة (Voice
// Session): merges slots remembered from earlier turns into the current
// utterance, and resolves references like "باسمه" / "نفس المشروع" against the
// last-mentioned entities. Pure logic — persistence lives in the repository.
// ============================================================

import type { EntityBag } from '@contractor-plus/shared';
import type { SessionContext } from './voice.types.js';

export class ContextManager {
  /**
   * Produce the effective entity bag for this turn by layering:
   *   prior remembered slots  ◂  this turn's freshly-extracted slots
   * then resolving references (entityRef) to concrete values from memory.
   *
   * IMPORTANT: a FRESH turn does NOT inherit prior-turn slot values (area, money,
   * …) — that bulk carry-over cross-contaminates unrelated commands (e.g. a stale
   * `area` steering "اربط هذا المشروع" to the wrong project). Progressive slot
   * filling is handled separately (the pending bag is merged at the call site).
   * Only explicit references (entityRef) are resolved from memory here.
   */
  resolve(freshBag: EntityBag, context: SessionContext): EntityBag {
    const merged: EntityBag = { ...stripUndefined(freshBag) };

    // "باسمه" / "اسمه" → reuse the last customer mentioned.
    if (merged.entityRef === 'last_customer' && !merged.customerName && context.lastCustomerName) {
      merged.customerName = context.lastCustomerName;
    }

    return merged;
  }

  /** Build the context patch to remember after a turn (last entities snapshot). */
  remember(previous: SessionContext, effectiveBag: EntityBag): SessionContext {
    return {
      ...previous,
      entities: { ...(previous.entities ?? {}), ...stripUndefined(effectiveBag) },
      ...(effectiveBag.customerName ? { lastCustomerName: effectiveBag.customerName } : {}),
    };
  }
}

function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
