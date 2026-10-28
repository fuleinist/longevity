import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareProducts } from '../src/compare.js';
import { makeProduct } from './helpers.js';

const good = makeProduct({
  id: 'good',
  name: 'Good Phone',
  price: {
    amount: 1000,
    currency: 'AUD',
    kind: 'street',
    checkedOn: '2026-10-28',
    sourceUrl: 'https://example.com',
    estimate: true,
  },
  ifixit: {
    wikiid: 1,
    title: 'Good Phone',
    url: 'https://www.ifixit.com/Device/Good_Phone',
    score: 9,
    guideCount: 40,
    toolCount: 12,
    fetchedAt: '2026-10-28T00:00:00.000Z',
  },
  partsUrl: 'https://example.com/parts',
});

const bad = makeProduct({
  id: 'bad',
  name: 'Bad Phone',
  price: {
    amount: 1400,
    currency: 'AUD',
    kind: 'street',
    checkedOn: '2026-10-28',
    sourceUrl: 'https://example.com',
    estimate: true,
  },
  ifixit: {
    wikiid: 2,
    title: 'Bad Phone',
    url: 'https://www.ifixit.com/Device/Bad_Phone',
    score: 3,
    guideCount: 2,
    toolCount: 1,
    fetchedAt: '2026-10-28T00:00:00.000Z',
  },
  repairCost: 300,
  repairEvents: 2,
});

test('compare marks the best score and the best cost', () => {
  const rows = compareProducts([bad, good]);
  assert.equal(rows[0]?.product.id, 'good');
  assert.equal(rows[0]?.bestScore, true);
  assert.equal(rows[0]?.bestCost, true);
  assert.equal(rows[1]?.bestScore, false);
  assert.equal(rows[1]?.bestCost, false);
});

test('compare rows carry score and yearly cost', () => {
  const rows = compareProducts([good, bad]);
  const goodRow = rows.find((row) => row.product.id === 'good');
  assert.equal(goodRow?.score, 91);
  assert.ok((goodRow?.perYear ?? 0) > 0);
  assert.ok((goodRow?.lifeYears ?? 0) > 5);
});

test('a product with no score still gets a row', () => {
  const plain = makeProduct({ id: 'plain', name: 'Plain Washer', category: 'washer' });
  const rows = compareProducts([plain]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.score, null);
  assert.equal(rows[0]?.bestScore, false);
  assert.equal(rows[0]?.bestCost, true);
});

test('ties mark every best row', () => {
  const twin = makeProduct({ ...good, id: 'twin', name: 'Twin Phone' });
  const rows = compareProducts([good, twin]);
  assert.equal(rows.filter((row) => row.bestScore).length, 2);
});