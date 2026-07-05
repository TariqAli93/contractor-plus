// ============================================================
// Contract estimate — the SINGLE source of the Material-Intelligence math.
//
// Pure (no DB, no IO). Both the authoritative `generateEstimate` (which persists
// items) and the read-only `previewEstimate` (used by the voice confirmation)
// call this, so a quote shown to the user can never diverge from what is saved.
//
// Scaling rule (المرحلة السادسة): template items are sized for a 100m² baseline;
// quantities and prices scale by (buildingArea × floors) / baseline. Frontage /
// depth do NOT enter material math — they only steer template SELECTION.
// ============================================================

import type { Prisma } from '@prisma/client';
import { money, round, sumMoney } from '../../lib/money.js';

type Numeric = Prisma.Decimal | number | string;

export interface EstimateItemInput {
  materialId: string;
  unit: string;
  estimatedQuantity: Numeric;
  estimatedPrice: Numeric;
  notes: string | null;
}

export interface ScaledItem {
  materialId: string;
  quantity: Prisma.Decimal;
  unit: string;
  estimatedPrice: Prisma.Decimal;
  notes: string | null;
}

export interface EstimateComputation {
  scaleFactor: Prisma.Decimal;
  scaledItems: ScaledItem[];
  estimatedMaterialCost: Prisma.Decimal;
  marginUsed: Prisma.Decimal | null;
  estimatedProfitAmount: Prisma.Decimal | null;
  suggestedSellingPrice: Prisma.Decimal | null;
  suggestedMeterPrice: Prisma.Decimal | null;
}

export interface EstimateParams {
  items: EstimateItemInput[];
  buildingArea: Numeric;
  floors: number;
  /** The contract's own margin (%) if set, else null. */
  contractMargin: Numeric | null;
  /** The template's suggested margin (%) — fallback when the contract has none. */
  templateMargin: Numeric | null;
  baselineArea: number;
}

export function computeContractEstimate(params: EstimateParams): EstimateComputation {
  const area = money(params.buildingArea);
  const scaleFactor = area.times(params.floors).div(params.baselineArea);

  const scaledItems: ScaledItem[] = params.items.map((item) => ({
    materialId: item.materialId,
    unit: item.unit,
    quantity: round(money(item.estimatedQuantity).times(scaleFactor), 3),
    estimatedPrice: round(money(item.estimatedPrice).times(scaleFactor)),
    notes: item.notes,
  }));

  const estimatedMaterialCost = round(sumMoney(scaledItems.map((i) => i.estimatedPrice)));

  // Margin (a percentage): the contract's own, else the template's suggestion.
  const marginSource = params.contractMargin !== null ? params.contractMargin : params.templateMargin;
  const marginUsed = marginSource !== null ? money(marginSource) : null;

  const estimatedProfitAmount =
    marginUsed !== null ? round(estimatedMaterialCost.times(marginUsed.div(100))) : null;
  const suggestedSellingPrice =
    estimatedProfitAmount !== null ? round(estimatedMaterialCost.plus(estimatedProfitAmount)) : null;

  const areaTimesFloors = area.times(params.floors);
  const suggestedMeterPrice =
    suggestedSellingPrice !== null && areaTimesFloors.gt(0)
      ? round(suggestedSellingPrice.div(areaTimesFloors))
      : null;

  return {
    scaleFactor,
    scaledItems,
    estimatedMaterialCost,
    marginUsed,
    estimatedProfitAmount,
    suggestedSellingPrice,
    suggestedMeterPrice,
  };
}
