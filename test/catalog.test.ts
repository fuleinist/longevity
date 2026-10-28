import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCatalog,
  categoryCounts,
  indexProducts,
  parseCatalog,
  readCatalogFile,
} from '../src/catalog.js';
import { DataError } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'sample-catalog.json');

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('parses the sample catalog', async () => {
  const catalog = parseCatalog(await fixture());
  assert.equal(catalog.version, 1);
  assert.equal(catalog.products.length, 2);
  assert.equal(catalog.products[0]?.id, 'fairphone-5');
  assert.equal(catalog.products[0]?.ifixit?.score, 10);
});

test('reads the catalog from disk', async () => {
  const catalog = await readCatalogFile(fixturePath);
  assert.equal(catalog.products[1]?.category, 'washer');
});

test('builds a sorted catalog with a timestamp', async () => {
  const catalog = parseCatalog(await fixture());
  const built = buildCatalog(catalog, '2026-10-28T00:00:00.000Z');
  assert.equal(built.generatedAt, '2026-10-28T00:00:00.000Z');
  assert.deepEqual(
    built.products.map((product) => product.id),
    ['fairphone-5', 'miele-w1-9kg'],
  );
});

test('indexes products by id and barcode', async () => {
  const catalog = parseCatalog(await fixture());
  const index = indexProducts(catalog.products);
  assert.equal(index.byId.get('fairphone-5')?.name, 'Fairphone 5');
  assert.equal(index.byBarcode.get('8712412001231')?.id, 'fairphone-5');
  assert.equal(index.byBarcode.get('0000000000000'), undefined);
});

test('counts products per category', async () => {
  const catalog = parseCatalog(await fixture());
  assert.deepEqual(categoryCounts(catalog.products), { phone: 1, laptop: 0, washer: 1 });
});

test('rejects a bad category', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  const products = raw['products'] as Record<string, unknown>[];
  products[0]!['category'] = 'toaster';
  assert.throws(() => parseCatalog(raw), (error: unknown) => {
    assert.ok(error instanceof DataError);
    assert.match(error.message, /category must be one of/);
    return true;
  });
});

test('rejects a duplicate id', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  const products = raw['products'] as Record<string, unknown>[];
  products[1]!['id'] = products[0]!['id'];
  assert.throws(() => parseCatalog(raw), /duplicate product id/);
});

test('rejects a bad price date', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  const products = raw['products'] as Record<string, unknown>[];
  (products[0]!['price'] as Record<string, unknown>)['checkedOn'] = '28-10-2026';
  assert.throws(() => parseCatalog(raw), /checkedOn must be YYYY-MM-DD/);
});

test('rejects a product with no sources', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  const products = raw['products'] as Record<string, unknown>[];
  products[0]!['sources'] = [];
  assert.throws(() => parseCatalog(raw), /sources must be a non-empty array/);
});

test('rejects an unknown top-level key', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  raw['extra'] = true;
  assert.throws(() => parseCatalog(raw), /unknown key/);
});

test('rejects a barcode with letters', async () => {
  const raw = (await fixture()) as Record<string, unknown>;
  const products = raw['products'] as Record<string, unknown>[];
  products[0]!['barcodes'] = ['ABC123'];
  assert.throws(() => parseCatalog(raw), /must be 8 to 14 digits/);
});

test('reports a missing file as a data error', async () => {
  await assert.rejects(
    () => readCatalogFile(join(here, 'no-such-file.json')),
    (error: unknown) => {
      assert.ok(error instanceof DataError);
      assert.match(error.message, /Cannot read catalog/);
      return true;
    },
  );
});