import { UsageError } from './errors.js';
import type { ProductIndex } from './catalog.js';
import type { Product } from './types.js';

export type BarcodeFormat = 'ean8' | 'ean13' | 'upca' | 'gtin14';

export interface BarcodeInfo {
  /** Digits as typed, with spaces and hyphens removed. */
  code: string;
  format: BarcodeFormat;
  /** The code padded on the left to 14 digits. */
  gtin14: string;
}

export type BarcodeCheck =
  | { ok: true; info: BarcodeInfo }
  | { ok: false; reason: string };

/** Standard GTIN check digit for a body without its check digit. */
export function checkDigitFor(body: string): number {
  let sum = 0;
  let weight = 3;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const digit = body.charCodeAt(index) - 48;
    sum += digit * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function inspectBarcode(input: string): BarcodeCheck {
  const code = input.replace(/[\s-]/g, '');
  if (code === '') return { ok: false, reason: 'The barcode is empty' };
  if (!/^\d+$/.test(code)) return { ok: false, reason: 'The barcode must contain digits only' };

  let format: BarcodeFormat;
  switch (code.length) {
    case 8:
      format = 'ean8';
      break;
    case 12:
      format = 'upca';
      break;
    case 13:
      format = 'ean13';
      break;
    case 14:
      format = 'gtin14';
      break;
    default:
      return {
        ok: false,
        reason: `The barcode has ${code.length} digits. Use EAN-8, UPC-A, EAN-13 or GTIN-14.`,
      };
  }

  const body = code.slice(0, -1);
  const expected = checkDigitFor(body);
  const actual = Number(code.slice(-1));
  if (expected !== actual) {
    return { ok: false, reason: `The check digit is wrong. Expected ${expected}, got ${actual}.` };
  }

  return {
    ok: true,
    info: {
      code,
      format,
      gtin14: code.padStart(14, '0'),
    },
  };
}

/** Like inspectBarcode, but throws a usage error on a bad code. */
export function requireBarcode(input: string): BarcodeInfo {
  const result = inspectBarcode(input);
  if (!result.ok) throw new UsageError(result.reason);
  return result.info;
}

/** Find a product by barcode. Tries the typed code and the padded form. */
export function findInIndex(info: BarcodeInfo, index: ProductIndex): Product | null {
  const variants = [
    ...new Set([
      info.code,
      info.gtin14,
      info.gtin14.slice(-13),
      info.gtin14.slice(-12),
    ]),
  ];
  for (const variant of variants) {
    const product = index.byBarcode.get(variant);
    if (product) return product;
  }
  return null;
}

export interface RemoteProduct {
  title: string;
  brand?: string;
  gtin?: string;
  source: 'upcitemdb';
  sourceUrl: string;
}

export interface ScanResult {
  info: BarcodeInfo;
  product: Product | null;
  remote: RemoteProduct | null;
  message: string;
}

/** Optional remote lookup. The trial endpoint needs no key and allows 100 calls per day. */
export async function lookupRemote(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteProduct | null> {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const item = items[0];
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const title = typeof record['title'] === 'string' ? record['title'] : '';
  if (title === '') return null;
  return {
    title,
    ...(typeof record['brand'] === 'string' ? { brand: record['brand'] } : {}),
    ...(typeof record['ean'] === 'string' ? { gtin: record['ean'] } : {}),
    source: 'upcitemdb',
    sourceUrl: url,
  };
}

/**
 * Scan a barcode against the index. The remote call is opt-in because it is
 * rate limited and needs the network.
 */
export async function scanBarcode(
  input: string,
  index: ProductIndex,
  options: { remote?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ScanResult> {
  const info = requireBarcode(input);
  const product = findInIndex(info, index);
  if (product) {
    return {
      info,
      product,
      remote: null,
      message: `${product.name} is in the index.`,
    };
  }
  if (!options.remote) {
    return {
      info,
      product: null,
      remote: null,
      message: 'The code is valid but the product is not in the index. Run with --remote to try the trial lookup.',
    };
  }
  const remote = await lookupRemote(info.gtin14, options.fetchImpl ?? fetch);
  return {
    info,
    product: null,
    remote,
    message: remote
      ? `Remote title: ${remote.title}. This product is not in the index.`
      : 'The code is valid but the product is not in the index. The remote lookup found nothing.',
  };
}