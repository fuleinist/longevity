/**
 * Shared score math for the web app.
 *
 * This module is plain ES JavaScript with no DOM access. The CLI implements
 * the same rules in TypeScript. The test suite compares both on every catalog
 * product, so the two views cannot drift.
 */

export const WEIGHTS = { repair: 65, support: 25, parts: 10 };

export const GUIDE_REFERENCE = 60;
export const TOOL_REFERENCE = 20;

export const CATEGORY_BASE_YEARS = { phone: 5, laptop: 7, washer: 12 };

export const AUDIT_QUESTIONS = [
  { id: 'drum-access', weight: 15, text: 'The drum or main module is accessible without moving the machine.' },
  { id: 'standard-fasteners', weight: 15, text: 'Fasteners are standard screws. No glue and no rivets.' },
  { id: 'bearings-separate', weight: 15, text: 'Bearings are sold as a separate part.' },
  { id: 'board-separate', weight: 15, text: 'The control board is sold as a separate part.' },
  { id: 'seal-pump-spares', weight: 15, text: 'The door seal and the pump are sold as spares.' },
  { id: 'error-codes', weight: 10, text: 'Error codes are readable without a service tool.' },
  { id: 'manual-public', weight: 10, text: 'A repair manual or a parts diagram is public.' },
  { id: 'spares-5y', weight: 5, text: 'The maker promises spare parts for 5 years or more.' },
];

export const CATEGORY_LABEL = { phone: 'Phone', laptop: 'Laptop', washer: 'Washing machine' };

export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function logScale(value, reference) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clamp((Math.log10(1 + value) / Math.log10(1 + reference)) * 100, 0, 100);
}

export function auditScore(audit) {
  if (!audit || !Array.isArray(audit.answers) || audit.answers.length === 0) return null;
  const yes = new Set(audit.answers.filter((a) => a.answer).map((a) => a.id));
  let score = 0;
  for (const question of AUDIT_QUESTIONS) {
    if (yes.has(question.id)) score += question.weight;
  }
  return score;
}

export function scoreBand(score) {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

export function scoreProduct(product) {
  const repairValue =
    product.ifixit && product.ifixit.score !== null ? clamp(product.ifixit.score * 10, 0, 100) : auditScore(product.audit);

  let supportValue = null;
  if (product.ifixit) {
    supportValue = round(
      logScale(product.ifixit.guideCount, GUIDE_REFERENCE) * 0.7 +
        logScale(product.ifixit.toolCount, TOOL_REFERENCE) * 0.3,
    );
  }

  const partsValue = product.partsUrl ? 100 : null;

  const parts = [
    {
      id: 'repair',
      label: 'Repair',
      weight: WEIGHTS.repair,
      value: repairValue,
      detail:
        repairValue === null
          ? 'No repair score and no self-audit'
          : product.ifixit && product.ifixit.score !== null
            ? `iFixit score ${product.ifixit.score}/10`
            : 'Self-audit score',
    },
    {
      id: 'support',
      label: 'Support',
      weight: WEIGHTS.support,
      value: supportValue,
      detail:
        supportValue === null
          ? 'No guide data'
          : `${product.ifixit.guideCount} guides, ${product.ifixit.toolCount} tools`,
    },
    {
      id: 'parts',
      label: 'Parts',
      weight: WEIGHTS.parts,
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
  return { score, parts, coverage: weightWithData, band: score === null ? null : scoreBand(score) };
}

export function lifeYearsFor(category, repairScore10) {
  const score = clamp(repairScore10 ?? 0, 0, 10);
  return round(CATEGORY_BASE_YEARS[category] * (0.55 + 0.09 * score), 1);
}

export function computeLifeCost({ price, repairCost, repairEvents, yearlyEnergyCost, category, repairScore10 }) {
  const lifeYears = lifeYearsFor(category, repairScore10);
  const purchase = price;
  const repairs = repairEvents * repairCost;
  const energy = yearlyEnergyCost * lifeYears;
  const total = purchase + repairs + energy;
  return {
    lifeYears,
    total: round(total, 2),
    perYear: round(total / lifeYears, 2),
    purchase: round(purchase, 2),
    repairs: round(repairs, 2),
    energy: round(energy, 2),
    energyKnown: yearlyEnergyCost > 0,
    repairScore10: repairScore10 ?? null,
  };
}

export function decide({ price, repairCost, lifeYears, ageYears }) {
  const life = lifeYears > 0 ? lifeYears : 1;
  const remainingYears = Math.max(0.5, life - ageYears);
  const repairPerYear = repairCost / remainingYears;
  const replacePerYear = price / life;
  const ratio = replacePerYear > 0 ? repairPerYear / replacePerYear : Number.POSITIVE_INFINITY;
  return {
    verdict: ratio <= 1 ? 'repair' : ratio <= 1.5 ? 'consider' : 'replace',
    ratio: round(ratio, 2),
    repairPerYear: round(repairPerYear, 2),
    replacePerYear: round(replacePerYear, 2),
    remainingYears: round(remainingYears, 1),
  };
}

export function analyze(product, options = {}, defaultTariff = 0.3) {
  const score = scoreProduct(product);
  const tariff = options.tariffAud ?? defaultTariff;
  const repairScore10 =
    options.repairScore10 !== undefined
      ? options.repairScore10
      : score.score === null
        ? null
        : score.score / 10;

  let annualKwh = null;
  let energySource = 'none';
  if (options.annualKwh !== undefined) {
    annualKwh = options.annualKwh;
    energySource = 'user';
  } else if (product.energy) {
    annualKwh = product.energy.annualKwh;
    energySource = 'catalog';
  }

  const lifeCost = computeLifeCost({
    price: options.price ?? product.price.amount,
    repairCost: product.repairCost,
    repairEvents: options.repairEvents ?? product.repairEvents,
    yearlyEnergyCost: annualKwh === null ? 0 : round(annualKwh * tariff, 2),
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

  return { product, score, lifeCost, decision, tariffAud: tariff, energySource, repairScore10 };
}

export function searchProducts(products, query, options = {}) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const hits = [];

  for (const product of products) {
    if (options.category && product.category !== options.category) continue;
    const fields = [
      { name: 'name', text: normalizeText(product.name), weight: 10 },
      { name: 'brand', text: normalizeText(product.brand), weight: 7 },
      { name: 'model', text: normalizeText(product.model), weight: 8 },
      { name: 'id', text: normalizeText(product.id), weight: 4 },
      { name: 'category', text: normalizeText(CATEGORY_LABEL[product.category] ?? product.category), weight: 2 },
    ];
    let rank = 0;
    let all = true;
    for (const token of tokens) {
      let tokenRank = 0;
      for (const field of fields) {
        if (field.text === token) tokenRank += field.weight + 6;
        else if (field.text.startsWith(token)) tokenRank += field.weight + 3;
        else if (field.text.includes(token)) tokenRank += field.weight;
      }
      if (tokenRank === 0) {
        all = false;
        break;
      }
      rank += tokenRank;
    }
    if (!all) continue;
    if (tokens.some((token) => normalizeText(product.brand).includes(token))) rank += 15;
    hits.push({ product, rank });
  }

  hits.sort((a, b) => b.rank - a.rank || a.product.name.localeCompare(b.product.name));
  return hits.slice(0, options.limit ?? 10);
}

export function checkDigitFor(body) {
  let sum = 0;
  let weight = 3;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += (body.charCodeAt(index) - 48) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function inspectBarcode(input) {
  const code = String(input).replace(/[\s-]/g, '');
  if (code === '') return { ok: false, reason: 'The barcode is empty' };
  if (!/^\d+$/.test(code)) return { ok: false, reason: 'The barcode must contain digits only' };
  const formats = { 8: 'ean8', 12: 'upca', 13: 'ean13', 14: 'gtin14' };
  const format = formats[code.length];
  if (!format) {
    return { ok: false, reason: `The barcode has ${code.length} digits. Use EAN-8, UPC-A, EAN-13 or GTIN-14.` };
  }
  const expected = checkDigitFor(code.slice(0, -1));
  const actual = Number(code.slice(-1));
  if (expected !== actual) {
    return { ok: false, reason: `The check digit is wrong. Expected ${expected}, got ${actual}.` };
  }
  return { ok: true, info: { code, format, gtin14: code.padStart(14, '0') } };
}