import type { ScoreBand, ScoreResult } from './types.js';
import { formatAud, formatAudPrecise } from './util.js';

export const BAND_LABEL: Record<ScoreBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export function bandLabel(band: ScoreBand | null): string {
  return band === null ? 'No score' : BAND_LABEL[band];
}

export function money(amount: number): string {
  return formatAud(amount);
}

/** Money with cents. Use it for unit prices such as the tariff. */
export function moneyPrecise(amount: number): string {
  return formatAudPrecise(amount);
}

export function scoreLine(result: ScoreResult): string {
  if (result.score === null) {
    return `No score (coverage ${result.coverage}%)`;
  }
  return `${result.score}/100 - ${bandLabel(result.band)} (coverage ${result.coverage}%)`;
}

/** Left-pad a label to a fixed width for the text tables. */
export function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}