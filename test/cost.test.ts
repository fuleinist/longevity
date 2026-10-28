import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLifeCost, lifeYearsFor, yearlyEnergyCost } from '../src/lifecost.js';
import { decide, verdictFor } from '../src/decide.js';

test('life years span the category base range', () => {
  assert.equal(lifeYearsFor('phone', 5), 5.0);
  assert.equal(lifeYearsFor('phone', 10), 7.3);
  assert.equal(lifeYearsFor('phone', 0), 2.8);
  assert.equal(lifeYearsFor('washer', null), 6.6);
  assert.equal(lifeYearsFor('laptop', 10), 10.2);
});

test('life cost adds purchase, repairs and energy', () => {
  const result = computeLifeCost({
    price: 1000,
    repairCost: 150,
    repairEvents: 1,
    yearlyEnergyCost: 0,
    category: 'phone',
    repairScore10: 5,
  });
  assert.equal(result.lifeYears, 5);
  assert.equal(result.purchase, 1000);
  assert.equal(result.repairs, 150);
  assert.equal(result.energy, 0);
  assert.equal(result.total, 1150);
  assert.equal(result.perYear, 230);
  assert.equal(result.energyKnown, false);
});

test('energy scales with life years', () => {
  const result = computeLifeCost({
    price: 1000,
    repairCost: 150,
    repairEvents: 1,
    yearlyEnergyCost: 60,
    category: 'phone',
    repairScore10: 5,
  });
  assert.equal(result.energy, 300);
  assert.equal(result.total, 1450);
  assert.equal(result.perYear, 290);
  assert.equal(result.energyKnown, true);
});

test('a product with no score uses the low factor', () => {
  const result = computeLifeCost({
    price: 2000,
    repairCost: 300,
    repairEvents: 2,
    yearlyEnergyCost: 0,
    category: 'washer',
    repairScore10: null,
  });
  assert.equal(result.lifeYears, 6.6);
  assert.equal(result.repairs, 600);
  assert.equal(result.total, 2600);
});

test('yearly energy cost uses the tariff', () => {
  assert.equal(yearlyEnergyCost(200, 0.3), 60);
  assert.equal(yearlyEnergyCost(0, 0.3), 0);
});

test('a cheap repair wins', () => {
  const result = decide({ price: 1000, repairCost: 150, lifeYears: 5, ageYears: 2 });
  assert.equal(result.remainingYears, 3);
  assert.equal(result.repairPerYear, 50);
  assert.equal(result.replacePerYear, 200);
  assert.equal(result.ratio, 0.25);
  assert.equal(result.verdict, 'repair');
});

test('an expensive repair loses', () => {
  const result = decide({ price: 400, repairCost: 300, lifeYears: 4, ageYears: 3 });
  assert.equal(result.remainingYears, 1);
  assert.equal(result.ratio, 3);
  assert.equal(result.verdict, 'replace');
});

test('a mid ratio asks for a decision', () => {
  const result = decide({ price: 1000, repairCost: 360, lifeYears: 5, ageYears: 3.5 });
  assert.equal(result.remainingYears, 1.5);
  assert.equal(result.ratio, 1.2);
  assert.equal(result.verdict, 'consider');
});

test('remaining years never fall below half a year', () => {
  const result = decide({ price: 1000, repairCost: 100, lifeYears: 5, ageYears: 9 });
  assert.equal(result.remainingYears, 0.5);
  assert.equal(result.repairPerYear, 200);
});

test('verdict limits match the spec', () => {
  assert.equal(verdictFor(1.0), 'repair');
  assert.equal(verdictFor(1.01), 'consider');
  assert.equal(verdictFor(1.5), 'consider');
  assert.equal(verdictFor(1.51), 'replace');
});