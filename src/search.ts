import { CATEGORY_LABEL, type Category, type Product } from './types.js';
import { normalizeText } from './util.js';

export interface SearchOptions {
  category?: Category;
  /** Maximum number of hits. Default 10. */
  limit?: number;
}

export interface SearchHit {
  product: Product;
  /** Rank value. Higher is better. */
  rank: number;
  /** Fields that matched at least one query token. */
  matched: string[];
}

interface Field {
  name: string;
  text: string;
  weight: number;
}

function fieldsOf(product: Product): Field[] {
  return [
    { name: 'name', text: normalizeText(product.name), weight: 10 },
    { name: 'brand', text: normalizeText(product.brand), weight: 7 },
    { name: 'model', text: normalizeText(product.model), weight: 8 },
    { name: 'id', text: normalizeText(product.id), weight: 4 },
    { name: 'category', text: normalizeText(CATEGORY_LABEL[product.category]), weight: 2 },
  ];
}

/**
 * Search the catalog by brand, model or category.
 *
 * All query tokens must match at least one field. A field that starts with
 * the token earns a bonus. Results sort by rank, then by name.
 */
export function searchProducts(
  products: Product[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const product of products) {
    if (options.category && product.category !== options.category) continue;
    const fields = fieldsOf(product);
    let rank = 0;
    const matched = new Set<string>();
    let allTokens = true;

    for (const token of tokens) {
      let tokenRank = 0;
      for (const field of fields) {
        if (field.text === token) tokenRank += field.weight + 6;
        else if (field.text.startsWith(token)) tokenRank += field.weight + 3;
        else if (field.text.includes(token)) tokenRank += field.weight;
      }
      if (tokenRank === 0) {
        allTokens = false;
        break;
      }
      rank += tokenRank;
      for (const field of fields) {
        if (field.text.includes(token)) matched.add(field.name);
      }
    }

    if (!allTokens) continue;
    // A brand match is the strongest signal for a buyer who types a brand.
    if (tokens.some((token) => normalizeText(product.brand).includes(token))) {
      rank += 15;
    }
    hits.push({ product, rank, matched: [...matched] });
  }

  hits.sort((a, b) => b.rank - a.rank || a.product.name.localeCompare(b.product.name));
  const limit = options.limit ?? 10;
  return hits.slice(0, Math.max(0, limit));
}

/** True when the query matches the product at all. */
export function matchesQuery(product: Product, query: string): boolean {
  return searchProducts([product], query, { limit: 1 }).length === 1;
}