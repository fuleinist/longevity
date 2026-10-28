import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogFile } from '../src/catalog.js';
import { scoreProduct } from '../src/score.js';
import { computeLifeCost, lifeYearsFor } from '../src/lifecost.js';
import { decide } from '../src/decide.js';
import * as web from '../web/score.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, '..', 'data', 'products.json');

test('the web score matches the CLI score for every product', async () => {
  const catalog = await readCatalogFile(dataPath);
  for (const product of catalog.products) {
    const cli = scoreProduct(product);
    const page = web.scoreProduct(product);
    assert.equal(page.score, cli.score, `${product.id} score`);
    assert.equal(page.coverage, cli.coverage, `${product.id} coverage`);
    assert.equal(page.band, cli.band, `${product.id} band`);
    assert.deepEqual(
      page.parts.map((part: { value: number | null }) => part.value),
      cli.parts.map((part) => part.value),
      `${product.id} parts`,
    );
  }
});

test('the web life cost matches the CLI for every product', async () => {
  const catalog = await readCatalogFile(dataPath);
  for (const product of catalog.products) {
    const score = scoreProduct(product).score;
    const repairScore10 = score === null ? null : score / 10;
    const cli = computeLifeCost({
      price: product.price.amount,
      repairCost: product.repairCost,
      repairEvents: product.repairEvents,
      yearlyEnergyCost: product.energy ? Math.round(product.energy.annualKwh * catalog.tariffAud * 100) / 100 : 0,
      category: product.category,
      repairScore10,
    });
    const page = web.computeLifeCost({
      price: product.price.amount,
      repairCost: product.repairCost,
      repairEvents: product.repairEvents,
      yearlyEnergyCost: product.energy ? Math.round(product.energy.annualKwh * catalog.tariffAud * 100) / 100 : 0,
      category: product.category,
      repairScore10,
    });
    assert.deepEqual(page, cli, `${product.id} life cost`);
    assert.equal(web.lifeYearsFor(product.category, repairScore10), lifeYearsFor(product.category, repairScore10));
  }
});

test('the web verdict matches the CLI', () => {
  const cases = [
    { price: 1000, repairCost: 150, lifeYears: 5, ageYears: 2 },
    { price: 400, repairCost: 300, lifeYears: 4, ageYears: 3 },
    { price: 1000, repairCost: 360, lifeYears: 5, ageYears: 3.5 },
    { price: 1000, repairCost: 100, lifeYears: 5, ageYears: 9 },
  ];
  for (const input of cases) {
    assert.deepEqual(web.decide(input), decide(input));
  }
});

test('the web search matches the CLI order', async () => {
  const catalog = await readCatalogFile(dataPath);
  const { searchProducts } = await import('../src/search.js');
  for (const query of ['macbook', 'apple', 'washing machine', 'framework']) {
    const cli = searchProducts(catalog.products, query).map((hit) => hit.product.id);
    const page = web.searchProducts(catalog.products, query).map((hit: { product: { id: string } }) => hit.product.id);
    assert.deepEqual(page, cli, `query "${query}"`);
  }
});

test('the web barcode check matches the CLI', async () => {
  const { inspectBarcode } = await import('../src/barcode.js');
  for (const code of ['5901234123457', '036000291452', '5901234123458', '12345', '10012345000017']) {
    const cli = inspectBarcode(code);
    const page = web.inspectBarcode(code);
    assert.equal(page.ok, cli.ok, `code ${code}`);
  }
});