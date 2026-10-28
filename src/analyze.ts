import { decide } from './decide.js';
import { computeLifeCost, yearlyEnergyCost } from './lifecost.js';
import { scoreProduct } from './score.js';
import type { Decision, LifeCostResult, Product, ScoreResult } from './types.js';

export interface AnalyzeOptions {
  /** Override the catalog price in AUD. */
  price?: number;
  /** Override the tariff in AUD per kWh. */
  tariffAud?: number;
  /** Override the yearly energy use in kWh. */
  annualKwh?: number;
  /** Override the repair scenario count. */
  repairEvents?: number;
  /** Age of the product in years. Enables the repair-or-replace verdict. */
  ageYears?: number;
  /** Override the repair score, 0 to 10. Useful for a what-if. */
  repairScore10?: number | null;
}

export interface Analysis {
  product: Product;
  score: ScoreResult;
  lifeCost: LifeCostResult;
  decision: Decision | null;
  tariffAud: number;
  /** Where the energy value came from. */
  energySource: 'catalog' | 'user' | 'none';
  repairScore10: number | null;
}

/**
 * Join the score, the life cost and the repair decision for one product.
 *
 * The caller can override the price, the tariff, the energy use, the repair
 * count and the product age.
 */
export function analyzeProduct(
  product: Product,
  options: AnalyzeOptions = {},
  defaultTariff = 0.3,
): Analysis {
  const score = scoreProduct(product);
  const tariff = options.tariffAud ?? defaultTariff;
  const repairScore10 =
    options.repairScore10 !== undefined
      ? options.repairScore10
      : score.score === null
        ? null
        : score.score / 10;

  let annualKwh: number | null = null;
  let energySource: Analysis['energySource'] = 'none';
  if (options.annualKwh !== undefined) {
    annualKwh = options.annualKwh;
    energySource = 'user';
  } else if (product.energy) {
    annualKwh = product.energy.annualKwh;
    energySource = 'catalog';
  }

  const energyCost = annualKwh === null ? 0 : yearlyEnergyCost(annualKwh, tariff);
  const lifeCost = computeLifeCost({
    price: options.price ?? product.price.amount,
    repairCost: product.repairCost,
    repairEvents: options.repairEvents ?? product.repairEvents,
    yearlyEnergyCost: energyCost,
    category: product.category,
    repairScore10,
  });

  const decision =
    options.ageYears === undefined
      ? null
      : decide({
          price: options.price ?? product.price.amount,
          repairCost: product.repairCost,
          lifeYears: lifeCost.lifeYears,
          ageYears: options.ageYears,
        });

  return {
    product,
    score,
    lifeCost,
    decision,
    tariffAud: tariff,
    energySource,
    repairScore10,
  };
}