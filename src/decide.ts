import type { Decision, Verdict } from './types.js';
import { round } from './util.js';

export const CONSIDER_RATIO = 1.0;
export const REPLACE_RATIO = 1.5;
/** The repair comparison needs at least half a year of remaining life. */
export const MIN_REMAINING_YEARS = 0.5;

export interface DecisionInput {
  /** Replacement price in AUD. */
  price: number;
  /** Typical repair cost in AUD. */
  repairCost: number;
  /** Estimated life in years from the life-cost model. */
  lifeYears: number;
  /** Age of the product in years. */
  ageYears: number;
}

export function verdictFor(ratio: number): Verdict {
  if (ratio <= CONSIDER_RATIO) return 'repair';
  if (ratio <= REPLACE_RATIO) return 'consider';
  return 'replace';
}

/**
 * Compare the cost of a repair with the cost of a replacement, per year of
 * remaining use.
 */
export function decide(input: DecisionInput): Decision {
  const lifeYears = input.lifeYears > 0 ? input.lifeYears : 1;
  const remainingYears = Math.max(MIN_REMAINING_YEARS, lifeYears - input.ageYears);
  const repairPerYear = input.repairCost / remainingYears;
  const replacePerYear = input.price / lifeYears;
  const ratio = replacePerYear > 0 ? repairPerYear / replacePerYear : Number.POSITIVE_INFINITY;
  return {
    verdict: verdictFor(ratio),
    ratio: round(ratio, 2),
    repairPerYear: round(repairPerYear, 2),
    replacePerYear: round(replacePerYear, 2),
    remainingYears: round(remainingYears, 1),
  };
}