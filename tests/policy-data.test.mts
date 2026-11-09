import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { loadPolicyData, policyVeto } from '../src/lib/jev/policy-data';
import { BUG_TRIAGE_FACT_DEFAULTS, runBugTriagePolicy } from '../src/lib/jev/policies/bug-triage';
import type { BugTriageFacts } from '../src/lib/jev/policies/bug-triage';

const contract = {
  facts: z.object({ count: z.number().nullable(), status: z.enum(['ok', 'bad']), items: z.array(z.string()) }),
  flags: ['stop'] as const,
  thresholds: z.strictObject({ limit: z.number() }),
};
const definition = () => ({
  id: 'test', version: '1', title: 'Test', thresholds: { limit: 3 },
  rules: [{ id: 'R1', label: 'Test rule', category: 'process', weight: 10, flags: ['stop'],
    when: { fact: 'count', op: 'gte', value: 3 } }],
  vetoes: [{ flag: 'stop', ruleId: 'R1', label: 'Stop', threshold: 'Stop now' }],
});
test('invalid policy definitions fail at load time with context', () => {
  const cases = [
    { rules: [{ ...definition().rules[0], when: { fact: 'missing', op: 'eq', value: 3 } }] },
    { rules: [{ ...definition().rules[0], when: { fact: 'count', op: 'gte', value: 'three' } }] },
    { rules: [{ ...definition().rules[0], when: { fact: 'status', op: 'eq', value: 'typo' } }] },
    { rules: [{ ...definition().rules[0], when: { fact: 'count', op: 'execute', value: 3 } }] },
    { rules: [{ ...definition().rules[0], when: { all: [] } }] },
    { rules: [{ ...definition().rules[0], when: { fact: 'status', projection: 'length', op: 'gt', value: 0 } }] },
    { rules: [{ ...definition().rules[0], flags: ['typo'] }] },
    { rules: [definition().rules[0], definition().rules[0]] },
    { vetoes: [{ ...definition().vetoes[0], ruleId: 'missing' }] },
    { thresholds: { typo: 3 } },
    { unexpected: true },
    { rules: [{ ...definition().rules[0], when: { fact: 'count', op: 'gte', value: { threshold: 'typo' } } }] },
    { rules: [{ ...definition().rules[0], label: 'Bad {typo}' }] },
    { vetoes: [{ ruleId: 'SCORE', label: 'Bad', threshold: 'Bad', minScore: { threshold: 'missing' } }] },
  ];
  for (const invalid of cases) assert.throws(() => loadPolicyData({ ...definition(), ...invalid }, contract), /Invalid policy/);
});
test('nested predicates, nullable numbers and array length preserve comparison semantics', () => {
  const data = definition();
  const loaded = loadPolicyData(data, contract);
  const matches = loaded.rules[0].when;
  assert.equal(matches({ count: null }), false);
  assert.equal(matches({ count: 2.99 }), false);
  assert.equal(matches({ count: 3 }), true);
  const nested = loadPolicyData({ ...data, rules: [{ ...data.rules[0], when: { all: [
    { any: [{ fact: 'status', op: 'eq', value: 'bad' }, { fact: 'count', op: 'lt', value: 0 }] },
    { fact: 'items', projection: 'length', op: 'gte', value: 2 },
  ] } }] }, contract);
  assert.equal(nested.rules[0].when({ status: 'bad', count: null, items: ['a', 'b'] }), true);
  assert.equal(nested.rules[0].when({ status: 'bad', count: null, items: ['a'] }), false);
  assert.equal(nested.rules[0].when({ status: 'ok', count: null, items: ['a', 'b'] }), false);
});
test('named thresholds drive both predicates and labels without duplicate constants', () => {
  const data = definition();
  const input = { ...data, thresholds: { limit: 7 }, rules: [{ ...data.rules[0],
    label: 'At least {limit}', when: { fact: 'count', op: 'gte', value: { threshold: 'limit' } },
  }], vetoes: [{ minScore: { threshold: 'limit' }, ruleId: 'SCORE', label: 'At {score}', threshold: '≥ {limit}' }] };
  const loaded = loadPolicyData(input, contract);
  assert.equal(loaded.rules[0].when({ count: 6 }), false);
  assert.equal(loaded.rules[0].when({ count: 7 }), true);
  assert.equal(loaded.rules[0].label, 'At least 7');
  assert.equal(loaded.vetoes[0].threshold, '≥ 7');
});
test('all comparison operators use strict typed semantics', () => {
  const expected = { eq: [false, true, false], ne: [true, false, true],
    gt: [false, false, true], gte: [false, true, true], lt: [true, false, false], lte: [true, true, false] };
  for (const [op, results] of Object.entries(expected)) {
    const data = definition();
    const loaded = loadPolicyData({ ...data, rules: [{ ...data.rules[0], when: { fact: 'count', op, value: 3 } }] }, contract);
    assert.deepEqual([2, 3, 4].map(count => loaded.rules[0].when({ count })), results, op);
  }
});
test('veto order is explicit and score placeholders are deterministic', () => {
  const ev = { rawScore: 90, score: 90, flags: ['stop'], fired: [], rulesEvaluated: 1 };
  const scoreVeto = { minScore: 80, ruleId: 'SCORE', label: 'Score {score}', threshold: '≥ 80' };
  const flagVeto = definition().vetoes[0];
  assert.equal(policyVeto([flagVeto, scoreVeto], ev)?.ruleId, 'R1');
  assert.deepEqual(policyVeto([scoreVeto, flagVeto], ev), { ruleId: 'SCORE', label: 'Score 90', threshold: '≥ 80' });
  assert.equal(policyVeto([scoreVeto], { ...ev, score: 79 }), null);
});

// Golden digest captured from the original TypeScript policy before migration.
// Covers every single-field value, threshold boundaries, and seeded combinations.
function parityCases(): BugTriageFacts[] {
  const values = {
    environment: ['production', 'staging', 'development', 'unknown'],
    customerImpact: ['none', 'single-user', 'small-subset', 'large-subset', 'all-users', 'unknown'],
    affectedUserEstimate: [null, 0, 49, 50, 51, 499, 500, 501, 1000],
    reproducibility: ['always', 'intermittent', 'once', 'cannot-reproduce', 'unknown'],
    hasWorkaround: [false, true], blocksCoreWorkflow: [false, true],
    dataLossOrCorruption: [false, true], securityImplication: [false, true],
    revenueImpacting: [false, true], regressionFromRecentRelease: [false, true],
    slaOrContractualRisk: [false, true], reportedBy: ['customer', 'internal', 'monitoring', 'unknown'],
    urgencySignal: ['low', 'medium', 'high', 'critical', 'unknown'],
    unknowns: [[], ['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']],
  };
  const cases: BugTriageFacts[] = [{ ...BUG_TRIAGE_FACT_DEFAULTS }];
  for (const [key, options] of Object.entries(values)) {
    for (const value of options) cases.push({ ...BUG_TRIAGE_FACT_DEFAULTS, [key]: value });
  }
  let seed = 20261109;
  for (let i = 0; i < 1000; i++) {
    const facts = { ...BUG_TRIAGE_FACT_DEFAULTS };
    for (const [key, options] of Object.entries(values)) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      Object.assign(facts, { [key]: options[seed % options.length] });
    }
    cases.push(facts);
  }
  return cases;
}
test('bug-triage decisions and traces remain byte-for-byte identical to the original policy', () => {
  const serialized = JSON.stringify(parityCases().map(runBugTriagePolicy));
  const digest = createHash('sha256').update(serialized).digest('hex');
  assert.equal(digest, '917181eaa5ae6659471f99dd1c5c9ee9c47765395e8c4122983e6909c2005aab');
  assert.equal(JSON.stringify(parityCases().map(runBugTriagePolicy)), serialized);
});
