import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogFile } from '../src/catalog.js';
import { inspectBarcode } from '../src/barcode.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, '..', 'data', 'products.json');

test('the seed catalog passes validation', async () => {
  const catalog = await readCatalogFile(dataPath);
  assert.equal(catalog.version, 1);
  assert.ok(catalog.products.length >= 15, 'catalog should have at least 15 products');
});

test('every product has a source and a review date', async () => {
  const catalog = await readCatalogFile(dataPath);
  for (const product of catalog.products) {
    assert.ok(product.sources.length > 0, `${product.id} has no sources`);
    assert.match(product.updatedAt, /^\d{4}-\d{2}-\d{2}$/, `${product.id} has no review date`);
  }
});

test('every phone and laptop has a published iFixit score', async () => {
  const catalog = await readCatalogFile(dataPath);
  const scored = catalog.products.filter((product) => product.category !== 'washer');
  assert.ok(scored.length >= 10, 'expected at least 10 phones and laptops');
  for (const product of scored) {
    assert.ok(product.ifixit, `${product.id} has no iFixit record`);
    assert.equal(typeof product.ifixit?.score, 'number', `${product.id} has no published score`);
    assert.ok((product.ifixit?.guideCount ?? 0) > 0, `${product.id} has no guides`);
  }
});

test('every washer has an energy estimate and no iFixit score', async () => {
  const catalog = await readCatalogFile(dataPath);
  const washers = catalog.products.filter((product) => product.category === 'washer');
  assert.ok(washers.length >= 4, 'expected at least 4 washing machines');
  for (const washer of washers) {
    assert.ok(washer.energy, `${washer.id} has no energy value`);
    assert.ok((washer.energy?.annualKwh ?? 0) > 0, `${washer.id} has a bad energy value`);
    assert.equal(washer.ifixit, undefined, `${washer.id} should not carry an iFixit score`);
  }
});

test('every iFixit title is unique', async () => {
  const catalog = await readCatalogFile(dataPath);
  const titles = catalog.products
    .map((product) => product.ifixit?.wikiid)
    .filter((value): value is number => typeof value === 'number');
  assert.equal(new Set(titles).size, titles.length, 'two products share one iFixit page');
});

test('prices are positive and dated', async () => {
  const catalog = await readCatalogFile(dataPath);
  for (const product of catalog.products) {
    assert.ok(product.price.amount > 0, `${product.id} has no price`);
    assert.match(product.price.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(product.price.currency, 'AUD');
  }
});

test('every catalog barcode passes its check digit', async () => {
  const catalog = await readCatalogFile(dataPath);
  for (const product of catalog.products) {
    for (const barcode of product.barcodes) {
      const result = inspectBarcode(barcode);
      assert.ok(result.ok, `${product.id} has a bad barcode ${barcode}`);
    }
  }
});