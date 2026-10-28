import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProduct } from '../src/analyze.js';
import { escapeHtml, renderReport } from '../src/report.js';
import { makeProduct } from './helpers.js';

const product = makeProduct({
  id: 'fairphone-5',
  name: 'Fairphone 5',
  brand: 'Fairphone',
  model: 'FP5',
  ifixit: {
    wikiid: 1,
    title: 'Fairphone 5',
    url: 'https://www.ifixit.com/Device/Fairphone_5',
    score: 10,
    guideCount: 11,
    toolCount: 4,
    fetchedAt: '2026-10-28T00:00:00.000Z',
  },
  partsUrl: 'https://shop.fairphone.com/en/spare-parts',
});

test('escaping covers the five HTML characters', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('the report is a standalone HTML page', () => {
  const html = renderReport(analyzeProduct(product), { now: new Date('2026-10-28T00:00:00Z') });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /2026-10-28/);
});

test('the report shows the score and the life cost', () => {
  const html = renderReport(analyzeProduct(product));
  assert.match(html, /\/100/);
  assert.match(html, /Life cost/);
  assert.match(html, /Per year/);
  assert.match(html, /A\$/);
});

test('the report escapes a hostile product name', () => {
  const hostile = makeProduct({ id: 'x', name: '<script>alert(1)</script>' });
  const html = renderReport(analyzeProduct(hostile));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('the report shows the verdict when the age is known', () => {
  const html = renderReport(analyzeProduct(product, { ageYears: 2 }));
  assert.match(html, /Repair or replace/);
  assert.match(html, /repair/i);
});

test('the report says when the age is missing', () => {
  const html = renderReport(analyzeProduct(product));
  assert.match(html, /Add the product age/);
});

test('the report lists repairers when given', () => {
  const html = renderReport(analyzeProduct(product), {
    repairers: [
      { id: 'node/1', name: 'Chatswood Phone Repair', kind: 'repair', lat: 0, lon: 0, distanceM: 1700, tags: {} },
    ],
  });
  assert.match(html, /Nearby repairers/);
  assert.match(html, /Chatswood Phone Repair/);
  assert.match(html, /1\.7 km/);
});

test('the report says when the energy term is missing', () => {
  const html = renderReport(analyzeProduct(product));
  assert.match(html, /no energy value/);
});