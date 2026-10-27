/**
 * Build data/products.json from the curated seed list and the iFixit API.
 *
 * Run: node scripts/seed-catalog.mjs
 *
 * The script is polite: one request every 450 ms. It fails loudly when a
 * phone or laptop entry gets no published score, so a silent data gap cannot
 * enter the catalog.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_ON, SEED } from './seed-products.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const API = 'https://www.ifixit.com/api/2.0';
const USER_AGENT = 'longevity/0.1 (catalog build; contact: github.com/fuleinist)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\u2122\u00ae]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    if (response.status === 429) {
      await sleep(2500 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  }
  throw new Error(`Rate limited three times for ${url}`);
}

async function findDevice(seed) {
  const data = await getJson(`${API}/search/${encodeURIComponent(seed.query)}`);
  const candidates = (data.results || []).filter((item) => item.namespace === 'CATEGORY');
  if (candidates.length === 0) return null;

  // Exact title wins. A substring match is the fallback, so a pick of
  // "iPhone 13 Pro" does not select "iPhone 13 Pro Max".
  if (seed.pick) {
    const wanted = normalize(seed.pick);
    const exactPick = candidates.find((item) => normalize(item.title) === wanted);
    if (exactPick) return exactPick;
    const partial = candidates.find((item) => normalize(item.title).includes(wanted));
    if (partial) return partial;
  }
  const exactQuery = candidates.find((item) => normalize(item.title) === normalize(seed.query));
  return exactQuery ?? candidates[0];
}

async function main() {
  const products = [];
  const report = [];

  for (const seed of SEED) {
    let product = {
      id: seed.id,
      brand: seed.brand,
      model: seed.model,
      name: seed.name,
      category: seed.category,
      barcodes: [],
      price: {
        amount: seed.price.amount,
        currency: 'AUD',
        kind: seed.price.kind,
        checkedOn: CHECKED_ON,
        sourceUrl: seed.price.sourceUrl,
        estimate: true,
      },
      repairCost: seed.repairCost,
      repairEvents: seed.repairEvents,
      ...(seed.repairNote ? { repairNote: seed.repairNote } : {}),
      ...(seed.serviceNote ? { serviceNote: seed.serviceNote } : {}),
      ...(seed.partsUrl ? { partsUrl: seed.partsUrl } : {}),
      ...(seed.energy ? { energy: seed.energy } : {}),
      updatedAt: CHECKED_ON,
      sources: [],
    };

    if (seed.query) {
      await sleep(450);
      const hit = await findDevice(seed);
      if (!hit) {
        report.push(`${seed.id}: iFixit has no category page for "${seed.query}"`);
      } else {
        await sleep(450);
        const wiki = await getJson(`${API}/wikis/${hit.wikiid}`);
        const guideCount = Array.isArray(wiki.guides) ? wiki.guides.length : 0;
        const toolCount = Array.isArray(wiki.tools) ? wiki.tools.length : 0;
        product.ifixit = {
          wikiid: hit.wikiid,
          title: wiki.title ?? hit.title,
          url: hit.url ?? `https://www.ifixit.com/Device/${encodeURIComponent(hit.title)}`,
          score: typeof wiki.repairability_score === 'number' ? wiki.repairability_score : null,
          guideCount,
          toolCount,
          ...(wiki.image && wiki.image.standard ? { imageUrl: wiki.image.standard } : {}),
          fetchedAt: new Date().toISOString(),
        };
        product.manualUrl = product.ifixit.url;
        report.push(
          `${seed.id}: ${product.ifixit.title} score=${product.ifixit.score} guides=${guideCount} tools=${toolCount}`,
        );
        if (['phone', 'laptop'].includes(seed.category) && product.ifixit.score === null) {
          report.push(`WARNING ${seed.id}: no published score for a ${seed.category}`);
        }
      }
    } else {
      report.push(`${seed.id}: no iFixit query, self-audit only`);
    }

    const sources = [
      ...(product.ifixit ? [product.ifixit.url] : []),
      seed.price.sourceUrl,
      ...(seed.partsUrl ? [seed.partsUrl] : []),
      ...(seed.energy ? [seed.energy.sourceUrl] : []),
    ];
    product.sources = [...new Set(sources)];

    products.push(product);
  }

  for (const line of report) console.log(line);

  const catalog = { version: 1, tariffAud: 0.3, products };
  await mkdir(join(root, 'data'), { recursive: true });
  const outPath = join(root, 'data', 'products.json');
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${products.length} products to ${outPath}`);

  const scored = products.filter((item) => item.ifixit && item.ifixit.score !== null).length;
  console.log(`Published scores: ${scored}/${products.length}`);
}

main().catch((error) => {
  console.error('FATAL:', error.message);
  process.exitCode = 1;
});