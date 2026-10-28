import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_QUESTIONS, buildAudit, auditScore, unansweredQuestions } from '../src/audit.js';
import { SCORE_WEIGHTS, logScale, repairPart, scoreBand, scoreProduct } from '../src/score.js';
import type { Audit, IfixitInfo } from '../src/types.js';

function ifixit(patch: Partial<IfixitInfo> = {}): IfixitInfo {
  return {
    wikiid: 1,
    title: 'Test device',
    url: 'https://www.ifixit.com/Device/Test',
    score: 10,
    guideCount: 60,
    toolCount: 20,
    fetchedAt: '2026-10-28T00:00:00.000Z',
    ...patch,
  };
}

function allYes(): Audit {
  return {
    answers: AUDIT_QUESTIONS.map((question) => ({ id: question.id, answer: true })),
    checkedOn: '2026-10-28',
  };
}

test('a full record scores 100 with full coverage', () => {
  const result = scoreProduct({ ifixit: ifixit(), partsUrl: 'https://example.com/parts' });
  assert.equal(result.score, 100);
  assert.equal(result.coverage, 100);
  assert.equal(result.band, 'excellent');
});

test('missing parts and low support lower the score and coverage', () => {
  const result = scoreProduct({
    ifixit: ifixit({ score: 7, guideCount: 0, toolCount: 0 }),
  });
  // (65 x 70 + 25 x 0) / 90 = 50.6, rounded to 51.
  assert.equal(result.score, 51);
  assert.equal(result.coverage, 90);
  assert.equal(result.band, 'fair');
  assert.equal(result.parts[2]?.value, null);
});

test('a product with no data has no score', () => {
  const result = scoreProduct({});
  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.equal(result.band, null);
});

test('a parts link alone gives 100 at 10 percent coverage', () => {
  const result = scoreProduct({ partsUrl: 'https://example.com/parts' });
  assert.equal(result.score, 100);
  assert.equal(result.coverage, 10);
});

test('the self-audit replaces a missing iFixit score', () => {
  const product = { ifixit: ifixit({ score: null }), audit: allYes() };
  assert.equal(repairPart(product), 100);
  const result = scoreProduct(product);
  // Repair 100 at 65, support 100 at 25. Parts missing.
  assert.equal(result.score, 100);
  assert.equal(result.coverage, 90);
});

test('the self-audit is used when iFixit is absent', () => {
  const audit = buildAudit({ 'drum-access': true, 'standard-fasteners': true }, '2026-10-28');
  assert.equal(auditScore(audit), 30);
  assert.equal(repairPart({ audit }), 30);
});

test('the three weights add up to 100', () => {
  const total = SCORE_WEIGHTS.repair + SCORE_WEIGHTS.support + SCORE_WEIGHTS.parts;
  assert.equal(total, 100);
});

test('logScale handles zero and the reference value', () => {
  assert.equal(logScale(0, 60), 0);
  assert.equal(logScale(60, 60), 100);
  assert.ok(logScale(10, 60) < 60);
});

test('score bands use the spec limits', () => {
  assert.equal(scoreBand(80), 'excellent');
  assert.equal(scoreBand(79), 'good');
  assert.equal(scoreBand(65), 'good');
  assert.equal(scoreBand(64), 'fair');
  assert.equal(scoreBand(45), 'fair');
  assert.equal(scoreBand(44), 'poor');
});

test('the audit weights add up to 100', () => {
  const total = AUDIT_QUESTIONS.reduce((sum, question) => sum + question.weight, 0);
  assert.equal(total, 100);
});

test('an empty audit has no score', () => {
  assert.equal(auditScore(undefined), null);
  assert.equal(auditScore({ answers: [], checkedOn: '2026-10-28' }), null);
});

test('unanswered audit questions count as no', () => {
  const partial: Audit = {
    answers: [{ id: 'drum-access', answer: true }],
    checkedOn: '2026-10-28',
  };
  assert.equal(auditScore(partial), 15);
  assert.equal(unansweredQuestions(partial).length, 7);
  assert.deepEqual(unansweredQuestions(partial).includes('drum-access'), false);
});

test('buildAudit drops unknown question ids', () => {
  const audit = buildAudit({ 'drum-access': true, toaster: true }, '2026-10-28');
  assert.equal(audit.answers.length, 1);
  assert.equal(audit.answers[0]?.id, 'drum-access');
});