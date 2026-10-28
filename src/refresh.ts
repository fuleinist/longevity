import { writeFile } from 'node:fs/promises';
import { readCatalogFile } from './catalog.js';
import type { CatalogFile, Product } from './types.js';

const API = 'https://www.ifixit.com/api/2.0';
const USER_AGENT = 'longevity/0.1 (score refresh; contact: github.com/fuleinist)';

export interface RefreshOptions {
  dataPath: string;
  /** Write here instead of dataPath. */
  outPath?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  now?: Date;
  /** Limit the refresh to these product ids. */
  only?: string[];
}

export interface RefreshFailure {
  id: string;
  error: string;
}

export interface RefreshResult {
  catalog: CatalogFile;
  updated: string[];
  unchanged: string[];
  skipped: string[];
  failures: RefreshFailure[];
  written: boolean;
}

interface WikiPayload {
  title?: unknown;
  repairability_score?: unknown;
  guides?: unknown;
  tools?: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  throw new Error('Rate limited three times');
}

/**
 * Refresh the iFixit score, guide count and tool count for each product that
 * has a wiki id. Other fields stay as they are.
 */
export async function refreshCatalog(options: RefreshOptions): Promise<RefreshResult> {
  const catalog = await readCatalogFile(options.dataPath);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const delay = options.delayMs ?? 450;
  const only = options.only ? new Set(options.only) : null;

  const updated: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const failures: RefreshFailure[] = [];

  const products: Product[] = [];
  let first = true;
  for (const product of catalog.products) {
    if (only && !only.has(product.id)) {
      skipped.push(product.id);
      products.push(product);
      continue;
    }
    if (!product.ifixit) {
      skipped.push(product.id);
      products.push(product);
      continue;
    }
    if (!first && delay > 0) await sleep(delay);
    first = false;

    let payload: unknown;
    try {
      payload = await getJson(`${API}/wikis/${product.ifixit.wikiid}`, fetchImpl);
    } catch (error) {
      failures.push({ id: product.id, error: error instanceof Error ? error.message : String(error) });
      products.push(product);
      continue;
    }

    const wiki = (typeof payload === 'object' && payload !== null ? payload : {}) as WikiPayload;
    const score = typeof wiki.repairability_score === 'number' ? wiki.repairability_score : null;
    const guideCount = Array.isArray(wiki.guides) ? wiki.guides.length : product.ifixit.guideCount;
    const toolCount = Array.isArray(wiki.tools) ? wiki.tools.length : product.ifixit.toolCount;
    const title = typeof wiki.title === 'string' ? wiki.title : product.ifixit.title;

    const changed =
      score !== product.ifixit.score ||
      guideCount !== product.ifixit.guideCount ||
      toolCount !== product.ifixit.toolCount ||
      title !== product.ifixit.title;

    if (changed) updated.push(product.id);
    else unchanged.push(product.id);

    products.push({
      ...product,
      ifixit: {
        ...product.ifixit,
        title,
        score,
        guideCount,
        toolCount,
        fetchedAt: now.toISOString(),
      },
    });
  }

  const nextCatalog: CatalogFile = { ...catalog, products };

  let written = false;
  if (!options.dryRun && (updated.length > 0 || failures.length > 0)) {
    await writeFile(options.outPath ?? options.dataPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8');
    written = true;
  }

  return { catalog: nextCatalog, updated, unchanged, skipped, failures, written };
}