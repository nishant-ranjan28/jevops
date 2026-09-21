import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, decisionConfidence, evaluate, type JevRule } from '../src/lib/jev/engine';

type Facts = { n: number; broken?: boolean };
type Flag = 'a' | 'b';

const rules: readonly JevRule<Facts, Flag>[] = [
  { id: 'R1', label: 'n over 10', category: 'impact', weight: 30, flags: ['a'], when: (f) => f.n > 10 },
  { id: 'R2', label: 'n over 5', category: 'impact', weight: 10, flags: ['a', 'b'], when: (f) => f.n > 5 },
  { id: 'R3', label: 'mitigation', category: 'process', weight: -12, when: (f) => f.n < 100 },
  { id: 'R4', label: 'never', category: 'process', weight: 99, when: () => false },
];

test('sums weights, unions flags, and records only fired rules', () => {
  const result = evaluate(rules, { n: 20 });
  assert.equal(result.rawScore, 28);
  assert.equal(result.score, 28);
  assert.deepEqual(result.flags.sort(), ['a', 'b']);
  assert.deepEqual(
    result.fired.map((r) => r.id),
    ['R1', 'R2', 'R3'],
  );
  assert.equal(result.rulesEvaluated, 4);
});

test('trace is ordered by weight, heaviest first', () => {
  const weights = evaluate(rules, { n: 20 }).fired.map((r) => r.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
});

test('score is clamped to 0..100 while rawScore is not', () => {
  const heavy: readonly JevRule<Facts, Flag>[] = [
    { id: 'H1', label: 'huge', category: 'impact', weight: 400, when: () => true },
  ];
  const result = evaluate(heavy, { n: 1 });
  assert.equal(result.rawScore, 400);
  assert.equal(result.score, 100);
  assert.equal(clamp(-40), 0);
});

test('a rule that throws is treated as not matching rather than crashing', () => {
  const dangerous: readonly JevRule<Facts, Flag>[] = [
    {
      id: 'BOOM',
      label: 'explodes',
      category: 'process',
      weight: 50,
      when: () => {
        throw new Error('bad fact');
      },
    },
    { id: 'OK', label: 'fine', category: 'process', weight: 7, when: () => true },
  ];
  const result = evaluate(dangerous, { n: 1 });
  assert.equal(result.score, 7);
  assert.deepEqual(
    result.fired.map((r) => r.id),
    ['OK'],
  );
});

test('confidence is discounted for every unknown fact', () => {
  const clean = decisionConfidence({ extractionConfidence: 0.9, unknownCount: 0, firedCount: 0 });
  const murky = decisionConfidence({ extractionConfidence: 0.9, unknownCount: 4, firedCount: 0 });
  assert.ok(murky < clean, 'unknowns must reduce confidence');
  assert.ok(decisionConfidence({ extractionConfidence: 1, unknownCount: 50, firedCount: 0 }) >= 0.05);
  assert.ok(decisionConfidence({ extractionConfidence: 1, unknownCount: 0, firedCount: 99 }) <= 0.99);
});

test('an unresolved field costs confidence even when the model did not flag it', () => {
  const honest = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 1,
    unresolvedCount: 1,
    firedCount: 0,
  });
  const quiet = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 0,
    unresolvedCount: 1,
    firedCount: 0,
  });
  assert.equal(quiet, honest, 'silence must not buy a higher confidence than candour');

  const complete = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 0,
    unresolvedCount: 0,
    firedCount: 0,
  });
  assert.ok(quiet < complete, 'a missing field must still cost something');
});

test('the larger of the two gap measures is the one that counts', () => {
  const flaggedMore = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 3,
    unresolvedCount: 1,
    firedCount: 0,
  });
  const unresolvedMore = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 1,
    unresolvedCount: 3,
    firedCount: 0,
  });
  assert.equal(flaggedMore, unresolvedMore);

  const three = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 3,
    unresolvedCount: 3,
    firedCount: 0,
  });
  assert.equal(three, flaggedMore, 'overlapping gaps are not double counted');
});

test('the missing-field penalty stays capped', () => {
  const floor = decisionConfidence({
    extractionConfidence: 1,
    unknownCount: 0,
    unresolvedCount: 99,
    firedCount: 0,
  });
  assert.equal(floor, 0.65, 'capped at 0.35 below a perfect extraction');
});

test('omitting unresolvedCount keeps the previous behaviour', () => {
  assert.equal(
    decisionConfidence({ extractionConfidence: 0.9, unknownCount: 2, firedCount: 1 }),
    decisionConfidence({
      extractionConfidence: 0.9,
      unknownCount: 2,
      unresolvedCount: 0,
      firedCount: 1,
    }),
  );
});
