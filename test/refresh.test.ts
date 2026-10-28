import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCatalog } from '../src/refresh.js';

const CATALOG = {
  version: 1,
  tariffAud: 0.3,
  products: [
    {
      id: 'fairphone-5',
      brand: 'Fairphone',
      model: 'FP5',
      name: 'Fairphone 5',
      category: 'phone',
      barcodes: [],
      price: {
        amount: 1149,
        currency: 'AUD',
        kind: 'street',
        checkedOn: '2026-10-28',
        sourceUrl: 'https://example.com/price',
        estimate: true,
      },
      repairCost: 220,
      repairEvents: 1,
      sources: ['https://example.com/source'],
      updatedAt: '2026-10-28',
      ifixit: {
        wikiid: 101,
        title: 'Fairphone 5',
        url: 'https://www.ifixit.com/Device/Fairphone_5',
        score: 9,
        guideCount: 10,
        toolCount: 4,
        fetchedAt: '2026-10-20T00:00:00.000Z',
      },
    },
    {
      id: 'miele-w1-9kg',
      brand: 'Miele',
      model: 'W1',
      name: 'Miele W1 9 kg',
      category: 'washer',
      barcodes: [],
      price: {
        amount: 2499,
        currency: 'AUD',
        kind: 'street',
        checkedOn: '2026-10-28',
        sourceUrl: 'https://example.com/price',
        estimate: true,
      },
      repairCost: 350,
      repairEvents: 2,
      sources: ['https://example.com/source'],
      updatedAt: '2026-10-28',
    },
  ],
};

function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

async function tempCatalog(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-refresh-'));
  const path = join(dir, 'products.json');
  await writeFile(path, `${JSON.stringify(CATALOG, null, 2)}\n`, 'utf8');
  return { dir, path };
}

test('refresh updates a changed score and guide count', async () => {
  const { dir, path } = await tempCatalog();
  try {
    const result = await refreshCatalog({
      dataPath: path,
      fetchImpl: fakeFetch({ title: 'Fairphone 5', repairability_score: 10, guides: [1, 2, 3], tools: [1] }),
      delayMs: 0,
      now: new Date('2026-10-29T00:00:00.000Z'),
    });
    const product = result.catalog.products.find((item) => item.id === 'fairphone-5');
    assert.equal(product?.ifixit?.score, 10);
    assert.equal(product?.ifixit?.guideCount, 3);
    assert.equal(product?.ifixit?.toolCount, 1);
    assert.deepEqual(result.updated, ['fairphone-5']);
    assert.deepEqual(result.skipped, ['miele-w1-9kg']);
    assert.equal(result.written, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refresh leaves an unchanged product alone', async () => {
  const { dir, path } = await tempCatalog();
  try {
    const result = await refreshCatalog({
      dataPath: path,
      fetchImpl: fakeFetch({
        title: 'Fairphone 5',
        repairability_score: 9,
        guides: Array.from({ length: 10 }, (_, index) => index),
        tools: [1, 2, 3, 4],
      }),
      delayMs: 0,
    });
    assert.deepEqual(result.unchanged, ['fairphone-5']);
    assert.deepEqual(result.updated, []);
    assert.equal(result.written, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refresh records a failure and keeps the old value', async () => {
  const { dir, path } = await tempCatalog();
  try {
    const result = await refreshCatalog({
      dataPath: path,
      fetchImpl: fakeFetch({}, 500),
      delayMs: 0,
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.error ?? '', /HTTP 500/);
    const product = result.catalog.products.find((item) => item.id === 'fairphone-5');
    assert.equal(product?.ifixit?.score, 9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a dry run does not write the file', async () => {
  const { dir, path } = await tempCatalog();
  try {
    const before = await readFile(path, 'utf8');
    const result = await refreshCatalog({
      dataPath: path,
      fetchImpl: fakeFetch({ title: 'Fairphone 5', repairability_score: 10, guides: [], tools: [] }),
      delayMs: 0,
      dryRun: true,
    });
    assert.equal(result.written, false);
    assert.equal(await readFile(path, 'utf8'), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refresh can be limited to one id', async () => {
  const { dir, path } = await tempCatalog();
  try {
    const result = await refreshCatalog({
      dataPath: path,
      fetchImpl: fakeFetch({ title: 'Fairphone 5', repairability_score: 10, guides: [], tools: [] }),
      delayMs: 0,
      only: ['miele-w1-9kg'],
    });
    assert.deepEqual(result.updated, []);
    // The washer has no iFixit record, so it is skipped as well.
    assert.deepEqual(result.skipped, ['fairphone-5', 'miele-w1-9kg']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});