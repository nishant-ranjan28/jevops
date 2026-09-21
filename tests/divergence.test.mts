import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDivergence } from '../src/lib/divergence';
import type { FiredRule } from '../src/lib/jev/engine';
import type { JevDecision, LlmRecommendation } from '../src/lib/types';

const trace: FiredRule<string>[] = [
  { id: 'DEP-ERR-001', label: 'error rate over ceiling', category: 'reliability', weight: 45, flags: [] },
  { id: 'DEP-CAN-004', label: 'canary healthy', category: 'reliability', weight: -10, flags: [] },
];

const decision = (stance: JevDecision['stance']): JevDecision => ({
  stance,
  headline: 'ROLLBACK',
  score: 79,
  scoreLabel: 'Deployment pressure',
  severityLabel: 'ROLLBACK',
  fields: [],
  requiredActions: [],
  veto: null,
  policyId: 'jev.deploy-gate',
  policyVersion: '1.3.0',
  rulesEvaluated: 21,
});

const llm = (stance: LlmRecommendation['stance']): LlmRecommendation => ({
  stance,
  headline: 'Ship it',
  rationale: '',
  confidence: 0.7,
});

test('model PROCEED against policy BLOCK is a three-step conflict', () => {
  const result = computeDivergence(llm('PROCEED'), decision('BLOCK'), trace);
  assert.equal(result.agree, false);
  assert.equal(result.delta, 3);
  assert.match(result.summary, /stricter/);
  assert.deepEqual(
    result.drivers.map((d) => d.id),
    ['DEP-ERR-001'],
    'drivers must be the escalating rules',
  );
});

test('matching stances report consensus with no drivers to explain', () => {
  const result = computeDivergence(llm('PROCEED'), decision('PROCEED'), []);
  assert.equal(result.agree, true);
  assert.equal(result.delta, 0);
  assert.match(result.summary, /uncontested/);
});

test('a model more cautious than the policy is reported as such', () => {
  const result = computeDivergence(llm('BLOCK'), decision('PROCEED'), trace);
  assert.equal(result.delta, -3);
  assert.match(result.summary, /more cautious/);
  assert.deepEqual(
    result.drivers.map((d) => d.id),
    ['DEP-CAN-004'],
    'drivers must be the mitigating rules',
  );
});
