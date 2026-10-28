import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, searchProducts } from '../src/search.js';
import { makeProduct } from './helpers.js';

const products = [
  makeProduct({ id: 'iphone-15', name: 'iPhone 15', brand: 'Apple', model: 'A3090' }),
  makeProduct({ id: 'iphone-14', name: 'iPhone 14', brand: 'Apple', model: 'A2882' }),
  makeProduct({ id: 'pixel-8', name: 'Google Pixel 8', brand: 'Google', model: 'GKWS6' }),
  makeProduct({
    id: 'framework-13',
    name: 'Framework Laptop 13',
    brand: 'Framework',
    model: 'DIY',
    category: 'laptop',
  }),
  makeProduct({
    id: 'bosch-6',
    name: 'Bosch Series 6',
    brand: 'Bosch',
    model: 'WGG24400',
    category: 'washer',
  }),
];

test('finds products by brand', () => {
  const hits = searchProducts(products, 'apple');
  assert.deepEqual(hits.map((hit) => hit.product.id), ['iphone-14', 'iphone-15']);
});

test('finds products by model code', () => {
  const hits = searchProducts(products, 'A3090');
  assert.equal(hits[0]?.product.id, 'iphone-15');
});

test('all query tokens must match', () => {
  assert.equal(searchProducts(products, 'iphone 15').length, 1);
  assert.equal(searchProducts(products, 'iphone 15').length, 1);
  assert.equal(searchProducts(products, 'iphone bosch').length, 0);
});

test('a category filter removes other categories', () => {
  const hits = searchProducts(products, 'laptop', { category: 'laptop' });
  assert.deepEqual(hits.map((hit) => hit.product.id), ['framework-13']);
  assert.equal(searchProducts(products, 'laptop', { category: 'phone' }).length, 0);
});

test('a category word matches the label', () => {
  const hits = searchProducts(products, 'washing machine');
  assert.deepEqual(hits.map((hit) => hit.product.id), ['bosch-6']);
});

test('brand matches rank above a model tail', () => {
  const hits = searchProducts(products, 'framework');
  assert.equal(hits[0]?.product.id, 'framework-13');
  assert.ok(hits[0]?.matched.includes('brand'));
});

test('a miss returns an empty list', () => {
  assert.deepEqual(searchProducts(products, 'toaster'), []);
  assert.deepEqual(searchProducts(products, ''), []);
});

test('the limit caps the result count', () => {
  const hits = searchProducts(products, 'iphone', { limit: 1 });
  assert.equal(hits.length, 1);
});

test('matchesQuery agrees with search', () => {
  assert.equal(matchesQuery(products[0]!, 'iphone'), true);
  assert.equal(matchesQuery(products[0]!, 'bosch'), false);
});

test('an empty product list returns no hits', () => {
  assert.deepEqual(searchProducts([], 'iphone'), []);
});