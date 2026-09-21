import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFields } from '../src/lib/jev/parse';
import {
  BUG_TRIAGE_FACT_DEFAULTS,
  bugTriageFactsSchema,
  runBugTriagePolicy,
} from '../src/lib/jev/policies/bug-triage';
import {
  DEPLOY_GATE_FACT_DEFAULTS,
  DEPLOY_GATE_THRESHOLDS,
  deployGateFactsSchema,
  runDeployGatePolicy,
} from '../src/lib/jev/policies/deploy-gate';
import {
  PR_RISK_FACT_DEFAULTS,
  prRiskFactsSchema,
  runPrRiskPolicy,
} from '../src/lib/jev/policies/pr-risk';

const deploy = (overrides: Record<string, unknown>) =>
  runDeployGatePolicy(
    parseFields(deployGateFactsSchema, DEPLOY_GATE_FACT_DEFAULTS, {
      ...DEPLOY_GATE_FACT_DEFAULTS,
      environment: 'production',
      hasRollbackPlan: true,
      observabilityCoverage: 'good',
      canaryStatus: 'healthy',
      ...overrides,
    }).value,
  );

const bug = (overrides: Record<string, unknown>) =>
  runBugTriagePolicy(
    parseFields(bugTriageFactsSchema, BUG_TRIAGE_FACT_DEFAULTS, {
      ...BUG_TRIAGE_FACT_DEFAULTS,
      ...overrides,
    }).value,
  );

const pr = (overrides: Record<string, unknown>) =>
  runPrRiskPolicy(
    parseFields(prRiskFactsSchema, PR_RISK_FACT_DEFAULTS, {
      ...PR_RISK_FACT_DEFAULTS,
      ...overrides,
    }).value,
  );

/* ------------------------------------------------------------ deploy gate */

test('error rate at the ceiling forces ROLLBACK through a named veto', () => {
  const { decision } = deploy({ errorRatePct: DEPLOY_GATE_THRESHOLDS.errorRateHardBlockPct });
  assert.equal(decision.stance, 'BLOCK');
  assert.equal(decision.headline, 'ROLLBACK');
  assert.equal(decision.veto?.ruleId, 'DEP-ERR-001');
  assert.match(decision.veto?.threshold ?? '', /ROLLBACK/);
});

test('error rate just below the ceiling holds instead of rolling back', () => {
  const { decision } = deploy({ errorRatePct: DEPLOY_GATE_THRESHOLDS.errorRateHardBlockPct - 0.1 });
  assert.equal(decision.headline, 'HOLD');
  assert.equal(decision.veto, null);
});

test('the veto beats the score: a low-pressure rollout still rolls back', () => {
  const { decision } = deploy({ errorRatePct: 99, canaryStatus: 'healthy', changeSize: 'small' });
  assert.equal(decision.headline, 'ROLLBACK');
  assert.equal(decision.veto?.ruleId, 'DEP-ERR-001');
});

test('a clean rollout is allowed at full traffic with nothing fired', () => {
  const { ev, decision } = deploy({
    errorRatePct: 0.05,
    baselineErrorRatePct: 0.05,
    p95LatencyMs: 180,
    baselineP95LatencyMs: 190,
    failedHealthChecks: 0,
    activeIncidents: 0,
    recentRollbacks24h: 0,
    trafficShiftedPct: 10,
    changeSize: 'small',
    deployWindow: 'off-hours',
  });
  assert.equal(decision.stance, 'PROCEED');
  assert.equal(decision.headline, 'ALLOW');
  assert.equal(decision.veto, null);
  assert.deepEqual(
    ev.fired.filter((r) => r.weight > 0).map((r) => r.id),
    [],
  );
});

test('a change freeze holds a rollout whose metrics are all green', () => {
  const { decision } = deploy({
    errorRatePct: 0.1,
    baselineErrorRatePct: 0.1,
    failedHealthChecks: 0,
    activeIncidents: 0,
    deployWindow: 'freeze',
    changeSize: 'small',
  });
  assert.equal(decision.headline, 'HOLD');
  assert.equal(decision.stance, 'HOLD');
});

/* ------------------------------------------------------------- bug triage */

test('data loss pages on-call however calmly the report is worded', () => {
  const { decision } = bug({
    environment: 'production',
    dataLossOrCorruption: true,
    urgencySignal: 'low',
    customerImpact: 'small-subset',
  });
  assert.equal(decision.veto?.ruleId, 'BUG-RISK-001');
  assert.ok(decision.fields.some((f) => f.label === 'Page on-call' && f.value === 'YES'));
});

test('a cosmetic development-only bug lands in the backlog', () => {
  const { decision } = bug({
    environment: 'development',
    hasWorkaround: true,
    customerImpact: 'single-user',
    urgencySignal: 'low',
    reproducibility: 'once',
  });
  assert.equal(decision.headline, 'S4 / P3');
  assert.equal(decision.stance, 'PROCEED');
  assert.equal(decision.veto, null);
});

/* ---------------------------------------------------------------- pr risk */

test('an irreversible migration without tests is vetoed to BLOCK', () => {
  const { decision } = pr({
    changeTypes: ['migration'],
    hasDatabaseMigration: true,
    hasSchemaChange: true,
    isRollbackSafe: false,
    hasTests: false,
    testCoverageSignal: 'none',
  });
  assert.equal(decision.stance, 'BLOCK');
  assert.ok(decision.veto, 'expected a veto');
  assert.match(decision.veto?.threshold ?? '', /BLOCK/);
});

test('a docs-only change is not penalised for shipping without tests', () => {
  const { ev, decision } = pr({ changeTypes: ['docs'], hasTests: false, testCoverageSignal: 'none' });
  assert.equal(decision.headline, 'SHIP');
  assert.equal(decision.score, 0);
  assert.ok(!ev.fired.some((r) => r.id === 'PR-TEST-001'));
});

test('touching auth always demands a security review', () => {
  const { decision } = pr({ touchesAuthOrCrypto: true, hasTests: true, testCoverageSignal: 'strong' });
  assert.ok(
    decision.fields.some((f) => f.label === 'Security review' && f.value === 'REQUIRED'),
  );
});

test('every mode reports how many rules it evaluated', () => {
  assert.ok(deploy({}).decision.rulesEvaluated > 0);
  assert.ok(bug({}).decision.rulesEvaluated > 0);
  assert.ok(pr({}).decision.rulesEvaluated > 0);
});
