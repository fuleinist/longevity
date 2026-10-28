import { CATEGORY_BASE_YEARS, type Category, type LifeCostInput, type LifeCostResult } from './types.js';
import { clamp, round } from './util.js';

/**
 * Life years from the category base and the repair score.
 *
 * A product with no score uses the low end of the range. The factor spans
 * 0.55 to 1.45.
 */
export function lifeYearsFor(category: Category, repairScore10: number | null): number {
  const score = clamp(repairScore10 ?? 0, 0, 10);
  const factor = 0.55 + 0.09 * score;
  return round(CATEGORY_BASE_YEARS[category] * factor, 1);
}

/**
 * Total cost of ownership over the estimated life.
 *
 * Energy is zero when the caller has no kWh value. The result says whether
 * the energy term was known.
 */
export function computeLifeCost(input: LifeCostInput): LifeCostResult {
  const lifeYears = lifeYearsFor(input.category, input.repairScore10);
  const purchase = input.price;
  const repairs = input.repairEvents * input.repairCost;
  const energy = input.yearlyEnergyCost * lifeYears;
  const total = purchase + repairs + energy;
  return {
    lifeYears,
    total: round(total, 2),
    perYear: round(total / lifeYears, 2),
    purchase: round(purchase, 2),
    repairs: round(repairs, 2),
    energy: round(energy, 2),
    energyKnown: input.yearlyEnergyCost > 0,
    repairScore10: input.repairScore10,
  };
}

/** Yearly energy cost in AUD from a kWh value and a tariff. */
export function yearlyEnergyCost(annualKwh: number, tariffAud: number): number {
  return round(annualKwh * tariffAud, 2);
}