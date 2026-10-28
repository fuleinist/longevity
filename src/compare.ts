import { analyzeProduct } from './analyze.js';
import type { Product } from './types.js';

export interface CompareRow {
  product: Product;
  score: number | null;
  coverage: number;
  lifeYears: number;
  total: number;
  perYear: number;
  /** True when this row has the highest score in the set. */
  bestScore: boolean;
  /** True when this row has the lowest cost per year in the set. */
  bestCost: boolean;
}

/**
 * Build comparison rows. The best score and the lowest cost per year are
 * marked. Ties mark every row that shares the best value.
 */
export function compareProducts(
  products: Product[],
  tariffAud = 0.3,
): CompareRow[] {
  const rows: CompareRow[] = products.map((product) => {
    const analysis = analyzeProduct(product, {}, tariffAud);
    return {
      product,
      score: analysis.score.score,
      coverage: analysis.score.coverage,
      lifeYears: analysis.lifeCost.lifeYears,
      total: analysis.lifeCost.total,
      perYear: analysis.lifeCost.perYear,
      bestScore: false,
      bestCost: false,
    };
  });

  const scores = rows.map((row) => row.score).filter((score): score is number => score !== null);
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;
  const bestCost = rows.length > 0 ? Math.min(...rows.map((row) => row.perYear)) : null;

  for (const row of rows) {
    row.bestScore = bestScore !== null && row.score === bestScore;
    row.bestCost = bestCost !== null && row.perYear === bestCost;
  }

  // Sort by score, then by cost per year. A missing score goes last.
  rows.sort((a, b) => {
    const scoreA = a.score ?? -1;
    const scoreB = b.score ?? -1;
    return scoreB - scoreA || a.perYear - b.perYear;
  });
  return rows;
}