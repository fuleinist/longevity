import { auditScore } from './audit.js';
import type { Product, ScoreBand, ScorePart, ScoreResult } from './types.js';
import { clamp, round } from './util.js';

/** Fixed weights from the spec. They add up to 100. */
export const SCORE_WEIGHTS = {
  repair: 65,
  support: 25,
  parts: 10,
} as const;

/** Guide count that earns a full support mark. */
const GUIDE_REFERENCE = 60;
/** Tool count that earns a full support mark. */
const TOOL_REFERENCE = 20;

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

/** Log scale from 0 to 100. The reference value maps to 100. */
export function logScale(value: number, reference: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const scaled = (Math.log10(1 + value) / Math.log10(1 + reference)) * 100;
  return clamp(scaled, 0, 100);
}

export type Scorable = Pick<Product, 'ifixit' | 'audit' | 'partsUrl'>;

/**
 * Compute the Longevity Score.
 *
 * The score has three parts. A part with no data is removed and the remaining
 * weights are scaled back to 100. Coverage reports the share of weight that
 * had data.
 */
export function scoreProduct(product: Scorable): ScoreResult {
  const repairValue = repairPart(product);
  const supportValue = supportPart(product);
  const partsValue = product.partsUrl ? 100 : null;

  const parts: ScorePart[] = [
    {
      id: 'repair',
      label: 'Repair',
      weight: SCORE_WEIGHTS.repair,
      value: repairValue,
      detail: repairDetail(product, repairValue),
    },
    {
      id: 'support',
      label: 'Support',
      weight: SCORE_WEIGHTS.support,
      value: supportValue,
      detail: supportDetail(product, supportValue),
    },
    {
      id: 'parts',
      label: 'Parts',
      weight: SCORE_WEIGHTS.parts,
      value: partsValue,
      detail: partsValue === null ? 'No spare-parts link on file' : 'Spare-parts page on file',
    },
  ];

  let weightWithData = 0;
  let weighted = 0;
  for (const part of parts) {
    if (part.value === null) continue;
    weightWithData += part.weight;
    weighted += part.weight * part.value;
  }

  const score = weightWithData === 0 ? null : round(weighted / weightWithData);
  return {
    score,
    parts,
    coverage: weightWithData,
    band: score === null ? null : scoreBand(score),
  };
}

/** iFixit score x 10, or the self-audit score. Null when both are missing. */
export function repairPart(product: Scorable): number | null {
  if (product.ifixit && product.ifixit.score !== null) {
    return clamp(product.ifixit.score * 10, 0, 100);
  }
  return auditScore(product.audit);
}

function supportPart(product: Scorable): number | null {
  if (!product.ifixit) return null;
  const guides = logScale(product.ifixit.guideCount, GUIDE_REFERENCE);
  const tools = logScale(product.ifixit.toolCount, TOOL_REFERENCE);
  return round(guides * 0.7 + tools * 0.3);
}

function repairDetail(product: Scorable, value: number | null): string {
  if (value === null) return 'No repair score and no self-audit';
  if (product.ifixit && product.ifixit.score !== null) {
    return `iFixit score ${product.ifixit.score}/10`;
  }
  return 'Self-audit score';
}

function supportDetail(product: Scorable, value: number | null): string {
  if (value === null || !product.ifixit) return 'No guide data';
  return `${product.ifixit.guideCount} guides, ${product.ifixit.toolCount} tools`;
}