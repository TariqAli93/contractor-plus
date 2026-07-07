// ============================================================
// Deterministic quantity / money math — the ONLY file in this feature that does
// arithmetic. Isolated so it is unit-testable with no DB or LLM, and so a
// reviewer auditing "is the math deterministic and Decimal-safe" has one file to
// read. Everything runs through lib/money.ts (Prisma.Decimal); never native
// float. The LLM supplies coefficients; THIS code multiplies and sums.
// ============================================================

import { CostCategory } from '@prisma/client';
import { money, round, sumMoney, toMoneyString, type Money } from '../../lib/money.js';
import type { EstimationDraftItemPayload } from './estimation-templates.types.js';

/** Reserved tempId for the synthetic, backend-computed waste line item. */
export const WASTE_TEMP_ID = '__waste__';

/** quantity = ratioPerAreaUnit × area, rounded to 3 dp (Decimal(14,3)). Returns
 *  null for a flat/lump-sum line (no ratio) or when the area is unknown. */
export function computeItemQuantity(
  ratioPerAreaUnit: number | null,
  areaValue: Money | null,
): Money | null {
  if (ratioPerAreaUnit === null || areaValue === null) return null;
  return round(money(ratioPerAreaUnit).times(areaValue), 3);
}

/** totalAmount, rounded to 2 dp (Decimal(14,2)):
 *   - quantity & unitPrice   → quantity × unitPrice
 *   - unitPrice only (no qty) → unitPrice acts as the flat lump-sum amount
 *   - otherwise              → 0 (e.g. a new material awaiting a price). */
export function computeItemTotal(quantity: Money | null, unitPrice: Money | null): Money {
  if (unitPrice === null) return money(0);
  if (quantity === null) return round(unitPrice, 2);
  return round(quantity.times(unitPrice), 2);
}

/** Waste amount = wastePercentage% × (sum of MATERIAL-line totals). Material
 *  waste only — never inflates labor/transport/misc lines. */
export function computeWasteAmount(materialSubtotal: Money, wastePercentage: Money): Money {
  return round(materialSubtotal.times(wastePercentage).dividedBy(100), 2);
}

function parseMoneyOrNull(v: string | null): Money | null {
  return v === null ? null : money(v);
}

/**
 * The single entry point called after ANY change to a draft (generation, refine,
 * a quantity/price edit, a material decision, a waste-% change). Recomputes every
 * item's quantity+total and the draft's grand total FROM SCRATCH (idempotent) and
 * rebuilds the synthetic waste line. Cheap; called liberally rather than patching
 * running totals incrementally.
 *
 * - A user-edited item keeps its stored quantity (the ratio is never re-applied);
 *   its total is still always re-derived from quantity × unitPrice.
 * - `totalAmount` is ALWAYS server-derived — never trusted from input.
 */
export function recomputeDraft(
  rawItems: EstimationDraftItemPayload[],
  areaValue: number | string | null,
  wastePercentage: number | string,
): { items: EstimationDraftItemPayload[]; total: string } {
  const area = areaValue === null ? null : money(areaValue);
  const wastePct = money(wastePercentage);

  // Drop any prior synthetic waste line; it is rebuilt below from current totals.
  const items = rawItems
    .filter((it) => it.tempId !== WASTE_TEMP_ID)
    .map((it) => {
      const quantity: Money | null = it.userEdited
        ? parseMoneyOrNull(it.quantity)
        : computeItemQuantity(it.ratioPerAreaUnit, area);
      const unitPrice = parseMoneyOrNull(it.unitPrice);
      const total = computeItemTotal(quantity, unitPrice);
      return {
        ...it,
        quantity: quantity === null ? null : toMoneyString(quantity, 3),
        totalAmount: toMoneyString(total, 2),
      };
    });

  const materialSubtotal = sumMoney(
    items.filter((it) => it.category === CostCategory.MATERIAL).map((it) => it.totalAmount),
  );

  const nextSortOrder = items.reduce((max, it) => Math.max(max, it.sortOrder), 0) + 1;

  if (wastePct.greaterThan(0) && materialSubtotal.greaterThan(0)) {
    const wasteAmount = computeWasteAmount(materialSubtotal, wastePct);
    items.push({
      tempId: WASTE_TEMP_ID,
      category: CostCategory.MISC,
      description: `Waste (${toMoneyString(wastePct, 2)}%)`,
      materialNameGuess: null,
      ratioPerAreaUnit: null,
      quantity: null,
      unit: null,
      unitPrice: null,
      totalAmount: toMoneyString(wasteAmount, 2),
      materialId: null,
      resolutionStatus: 'SKIPPED',
      sortOrder: nextSortOrder,
      notes: null,
      userEdited: false,
    });
  }

  const total = sumMoney(items.map((it) => it.totalAmount));
  return { items, total: toMoneyString(total, 2) };
}
