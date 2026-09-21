import { z } from 'zod';
import { evaluate, has, type JevEvaluation, type JevPolicy, type JevRule } from '../engine';
import type { DecisionField, JevDecision, Stance, Veto } from '../../types';

/* ------------------------------------------------------------------ facts */

export const deployGateFactsSchema = z.object({
  service: z.string(),
  environment: z.enum(['production', 'staging', 'canary', 'unknown']),
  summary: z.string(),
  errorRatePct: z.number().nonnegative().nullable(),
  baselineErrorRatePct: z.number().nonnegative().nullable(),
  p95LatencyMs: z.number().nonnegative().nullable(),
  baselineP95LatencyMs: z.number().nonnegative().nullable(),
  cpuSaturationPct: z.number().nonnegative().nullable(),
  memorySaturationPct: z.number().nonnegative().nullable(),
  failedHealthChecks: z.number().int().nonnegative().nullable(),
  activeIncidents: z.number().int().nonnegative().nullable(),
  recentRollbacks24h: z.number().int().nonnegative().nullable(),
  canaryStatus: z.enum(['healthy', 'degraded', 'failing', 'not-run', 'unknown']),
  deployWindow: z.enum(['business-hours', 'off-hours', 'freeze', 'unknown']),
  trafficShiftedPct: z.number().min(0).max(100).nullable(),
  observabilityCoverage: z.enum(['good', 'partial', 'none', 'unknown']),
  hasRollbackPlan: z.boolean(),
  changeSize: z.enum(['small', 'medium', 'large', 'unknown']),
  dependencyDegradations: z.array(z.string()),
  unknowns: z.array(z.string()),
});

export type DeployGateFacts = z.infer<typeof deployGateFactsSchema>;

export const DEPLOY_GATE_FACT_DEFAULTS: DeployGateFacts = {
  service: 'unknown-service',
  environment: 'unknown',
  summary: '',
  errorRatePct: null,
  baselineErrorRatePct: null,
  p95LatencyMs: null,
  baselineP95LatencyMs: null,
  cpuSaturationPct: null,
  memorySaturationPct: null,
  failedHealthChecks: null,
  activeIncidents: null,
  recentRollbacks24h: null,
  canaryStatus: 'unknown',
  deployWindow: 'unknown',
  trafficShiftedPct: null,
  observabilityCoverage: 'unknown',
  hasRollbackPlan: false,
  changeSize: 'unknown',
  dependencyDegradations: [],
  unknowns: [],
};


/* ------------------------------------------------------------------ flags */

export type DeployGateFlag =
  | 'rollback'
  | 'hold'
  | 'canary-only'
  | 'freeze-violation'
  | 'page'
  | 'observability-gap'
  | 'no-rollback-plan'
  | 'saturation'
  | 'latency-regression'
  | 'error-budget-burn'
  | 'dependency-degraded';

/**
 * The numbers that make Jev non-negotiable. A model can be talked into
 * "it's probably fine". These constants cannot.
 */
export const DEPLOY_GATE_THRESHOLDS = {
  errorRateHardBlockPct: 2.0,
  errorRateWarnPct: 1.0,
  errorRateBaselineMultiplier: 3,
  latencyRegressionPct: 30,
  saturationPct: 85,
  failedHealthCheckLimit: 3,
  rollbackChurnLimit: 2,
  holdScore: 55,
  canaryScore: 25,
} as const;

const T = DEPLOY_GATE_THRESHOLDS;

const latencyRegressionPct = (f: DeployGateFacts): number | null => {
  if (f.p95LatencyMs == null || f.baselineP95LatencyMs == null || f.baselineP95LatencyMs === 0) return null;
  return ((f.p95LatencyMs - f.baselineP95LatencyMs) / f.baselineP95LatencyMs) * 100;
};

/* ------------------------------------------------------------------ rules */

export const deployGateRules: readonly JevRule<DeployGateFacts, DeployGateFlag>[] = [
  {
    id: 'DEP-ERR-001',
    label: `Production error rate is at or above the hard policy ceiling of ${T.errorRateHardBlockPct}%`,
    category: 'reliability',
    weight: 45,
    flags: ['rollback', 'page', 'error-budget-burn'],
    when: (f) => f.errorRatePct != null && f.errorRatePct >= T.errorRateHardBlockPct,
  },
  {
    id: 'DEP-ERR-002',
    label: `Error rate is above the ${T.errorRateWarnPct}% warning threshold`,
    category: 'reliability',
    weight: 20,
    flags: ['hold', 'error-budget-burn'],
    when: (f) =>
      f.errorRatePct != null &&
      f.errorRatePct >= T.errorRateWarnPct &&
      f.errorRatePct < T.errorRateHardBlockPct,
  },
  {
    id: 'DEP-ERR-003',
    label: `Error rate is more than ${T.errorRateBaselineMultiplier}x its own baseline`,
    category: 'reliability',
    weight: 18,
    flags: ['error-budget-burn', 'hold'],
    when: (f) =>
      f.errorRatePct != null &&
      f.baselineErrorRatePct != null &&
      f.baselineErrorRatePct > 0 &&
      f.errorRatePct >= f.baselineErrorRatePct * T.errorRateBaselineMultiplier,
  },
  {
    id: 'DEP-CAN-001',
    label: 'Canary is failing',
    category: 'reliability',
    weight: 40,
    flags: ['rollback', 'page'],
    when: (f) => f.canaryStatus === 'failing',
  },
  {
    id: 'DEP-CAN-002',
    label: 'Canary is degraded',
    category: 'reliability',
    weight: 22,
    flags: ['hold'],
    when: (f) => f.canaryStatus === 'degraded',
  },
  {
    id: 'DEP-CAN-003',
    label: 'No canary has been run for this rollout',
    category: 'operational',
    weight: 10,
    flags: ['canary-only'],
    when: (f) => f.canaryStatus === 'not-run' && f.environment === 'production',
  },
  {
    id: 'DEP-CAN-004',
    label: 'Canary is reporting healthy',
    category: 'reliability',
    weight: -10,
    when: (f) => f.canaryStatus === 'healthy',
  },
  {
    id: 'DEP-HLT-001',
    label: `At least ${T.failedHealthCheckLimit} health checks are failing`,
    category: 'reliability',
    weight: 35,
    flags: ['rollback', 'page'],
    when: (f) => (f.failedHealthChecks ?? 0) >= T.failedHealthCheckLimit,
  },
  {
    id: 'DEP-HLT-002',
    label: 'Health checks are failing intermittently',
    category: 'reliability',
    weight: 14,
    flags: ['hold'],
    when: (f) => {
      const n = f.failedHealthChecks ?? 0;
      return n > 0 && n < T.failedHealthCheckLimit;
    },
  },
  {
    id: 'DEP-LAT-001',
    label: `p95 latency has regressed by more than ${T.latencyRegressionPct}% against baseline`,
    category: 'reliability',
    weight: 18,
    flags: ['latency-regression', 'hold'],
    when: (f) => {
      const pct = latencyRegressionPct(f);
      return pct != null && pct >= T.latencyRegressionPct;
    },
  },
  {
    id: 'DEP-SAT-001',
    label: `CPU or memory saturation is above ${T.saturationPct}%`,
    category: 'operational',
    weight: 16,
    flags: ['saturation', 'hold'],
    when: (f) =>
      (f.cpuSaturationPct ?? 0) >= T.saturationPct || (f.memorySaturationPct ?? 0) >= T.saturationPct,
  },
  {
    id: 'DEP-INC-001',
    label: 'An incident is already open on this service',
    category: 'operational',
    weight: 24,
    flags: ['hold', 'page'],
    when: (f) => (f.activeIncidents ?? 0) > 0,
  },
  {
    id: 'DEP-INC-002',
    label: `More than ${T.rollbackChurnLimit} rollbacks in the last 24 hours — the pipeline is unstable`,
    category: 'operational',
    weight: 16,
    flags: ['hold'],
    when: (f) => (f.recentRollbacks24h ?? 0) > T.rollbackChurnLimit,
  },
  {
    id: 'DEP-DEP-001',
    label: 'An upstream dependency is degraded',
    category: 'operational',
    weight: 14,
    flags: ['dependency-degraded', 'canary-only'],
    when: (f) => f.dependencyDegradations.length > 0,
  },
  {
    id: 'DEP-WIN-001',
    label: 'Deploy falls inside a declared change freeze',
    category: 'process',
    weight: 30,
    flags: ['hold', 'freeze-violation'],
    when: (f) => f.deployWindow === 'freeze',
  },
  {
    id: 'DEP-OBS-001',
    label: 'Observability coverage is missing — a regression would go unnoticed',
    category: 'operational',
    weight: 18,
    flags: ['observability-gap', 'hold'],
    when: (f) => f.observabilityCoverage === 'none',
  },
  {
    id: 'DEP-OBS-002',
    label: 'Observability coverage is only partial',
    category: 'operational',
    weight: 8,
    flags: ['observability-gap', 'canary-only'],
    when: (f) => f.observabilityCoverage === 'partial',
  },
  {
    id: 'DEP-ROL-001',
    label: 'No verified rollback plan for a production deploy',
    category: 'process',
    weight: 14,
    flags: ['no-rollback-plan', 'canary-only'],
    when: (f) => !f.hasRollbackPlan && f.environment === 'production',
  },
  {
    id: 'DEP-CHG-001',
    label: 'Large change being pushed straight to production',
    category: 'blast-radius',
    weight: 10,
    flags: ['canary-only'],
    when: (f) => f.changeSize === 'large' && f.environment === 'production',
  },
  {
    id: 'DEP-TRF-001',
    label: 'Full traffic is already shifted onto the new version',
    category: 'blast-radius',
    weight: 8,
    when: (f) => (f.trafficShiftedPct ?? 0) >= 100 && f.environment === 'production',
  },
  {
    id: 'DEP-PROC-001',
    label: 'Three or more deployment signals are missing from the report',
    category: 'process',
    weight: 8,
    flags: ['canary-only'],
    when: (f) => f.unknowns.length >= 3,
  },
];

/* --------------------------------------------------------------- decision */

export type Gate = 'ALLOW' | 'ALLOW_CANARY' | 'HOLD' | 'ROLLBACK';

export interface DeployGateDecision {
  pressureScore: number;
  gate: Gate;
  pageOncall: boolean;
  maxTrafficPct: number;
  monitoringWindowMinutes: number;
  errorBudgetVerdict: 'WITHIN_BUDGET' | 'BURNING' | 'EXHAUSTED';
  requiredActions: string[];
  /** The single rule that forced a hard gate, if any. */
  veto: Veto | null;
}

const STANCE_BY_GATE: Record<Gate, Stance> = {
  ALLOW: 'PROCEED',
  ALLOW_CANARY: 'PROCEED_WITH_GUARDRAILS',
  HOLD: 'HOLD',
  ROLLBACK: 'BLOCK',
};

/**
 * Rules that decide the gate on their own. Everything else contributes to a
 * score; these three simply end the conversation.
 */
const HARD_GATE_THRESHOLDS: Record<string, string> = {
  'DEP-ERR-001': `error rate ≥ ${T.errorRateHardBlockPct}% ⇒ ROLLBACK`,
  'DEP-CAN-001': 'canary failing ⇒ ROLLBACK',
  'DEP-HLT-001': `≥ ${T.failedHealthCheckLimit} failed health checks ⇒ ROLLBACK`,
};

function deployVeto(ev: JevEvaluation<DeployGateFlag>): Veto | null {
  const fired = ev.fired.find((r) => r.id in HARD_GATE_THRESHOLDS);
  if (!fired) return null;
  return {
    ruleId: fired.id,
    label: fired.label,
    threshold: HARD_GATE_THRESHOLDS[fired.id],
  };
}

export const deployGatePolicy: JevPolicy<DeployGateFacts, DeployGateFlag, DeployGateDecision> = {
  id: 'jev.deploy-gate',
  version: '1.3.0',
  title: 'Deployment Gate Policy',
  rules: deployGateRules,
  derive(facts, ev) {
    const score = ev.score;
    const veto = deployVeto(ev);

    const gate: Gate = has(ev, 'rollback')
      ? 'ROLLBACK'
      : has(ev, 'hold') || score >= T.holdScore
        ? 'HOLD'
        : has(ev, 'canary-only') || score >= T.canaryScore
          ? 'ALLOW_CANARY'
          : 'ALLOW';

    const errorBudgetVerdict =
      facts.errorRatePct != null && facts.errorRatePct >= T.errorRateHardBlockPct
        ? 'EXHAUSTED'
        : has(ev, 'error-budget-burn')
          ? 'BURNING'
          : 'WITHIN_BUDGET';

    const maxTrafficPct = gate === 'ALLOW' ? 100 : gate === 'ALLOW_CANARY' ? 10 : 0;
    const monitoringWindowMinutes = gate === 'ALLOW' ? 15 : gate === 'ALLOW_CANARY' ? 45 : 60;

    const requiredActions: string[] = [];
    if (gate === 'ROLLBACK') {
      requiredActions.push('Roll back to the last known-good revision now');
      requiredActions.push('Freeze the deploy pipeline for this service until the cause is understood');
    }
    if (has(ev, 'page')) requiredActions.push('Page the service on-call engineer');
    if (gate === 'HOLD') requiredActions.push('Hold the rollout at its current traffic split');
    if (gate === 'ALLOW_CANARY') requiredActions.push(`Cap traffic at ${maxTrafficPct}% and soak for ${monitoringWindowMinutes} minutes`);
    if (has(ev, 'freeze-violation')) requiredActions.push('Obtain a documented change-freeze exception before proceeding');
    if (has(ev, 'observability-gap')) requiredActions.push('Add error-rate and latency alerting before widening traffic');
    if (has(ev, 'no-rollback-plan')) requiredActions.push('Write and rehearse the rollback procedure');
    if (has(ev, 'dependency-degraded')) requiredActions.push(`Confirm recovery of: ${facts.dependencyDegradations.join(', ')}`);
    if (has(ev, 'saturation')) requiredActions.push('Scale out before increasing traffic share');
    if (requiredActions.length === 0) requiredActions.push(`Proceed to 100% and watch for ${monitoringWindowMinutes} minutes`);

    return {
      pressureScore: score,
      gate,
      pageOncall: has(ev, 'page'),
      maxTrafficPct,
      monitoringWindowMinutes,
      errorBudgetVerdict,
      requiredActions,
      veto,
    };
  },
};

const gateTone = (g: Gate): DecisionField['tone'] =>
  g === 'ROLLBACK' ? 'bad' : g === 'HOLD' ? 'warn' : g === 'ALLOW_CANARY' ? 'neutral' : 'good';

export function presentDeployGate(
  d: DeployGateDecision,
  ev: JevEvaluation<DeployGateFlag>,
): JevDecision {
  return {
    stance: STANCE_BY_GATE[d.gate],
    headline: d.gate.replaceAll('_', ' '),
    score: d.pressureScore,
    scoreLabel: 'Deployment pressure',
    severityLabel: d.gate,
    policyId: deployGatePolicy.id,
    policyVersion: deployGatePolicy.version,
    rulesEvaluated: ev.rulesEvaluated,
    veto: d.veto,
    requiredActions: d.requiredActions,
    fields: [
      { label: 'Gate', value: d.gate.replaceAll('_', ' '), tone: gateTone(d.gate) },
      {
        label: 'Error budget',
        value: d.errorBudgetVerdict.replaceAll('_', ' '),
        tone:
          d.errorBudgetVerdict === 'EXHAUSTED' ? 'bad' : d.errorBudgetVerdict === 'BURNING' ? 'warn' : 'good',
      },
      { label: 'Max traffic', value: `${d.maxTrafficPct}%`, tone: d.maxTrafficPct === 0 ? 'bad' : d.maxTrafficPct < 100 ? 'warn' : 'good' },
      { label: 'Soak window', value: `${d.monitoringWindowMinutes} min`, tone: 'neutral' },
      { label: 'Page on-call', value: d.pageOncall ? 'YES' : 'No', tone: d.pageOncall ? 'bad' : 'good' },
      {
        label: 'Hard veto',
        value: d.veto?.ruleId ?? 'None',
        tone: d.veto ? 'bad' : 'good',
        hint: d.veto?.threshold ?? 'No threshold rule overrode the aggregate score',
      },
    ],
  };
}

export function runDeployGatePolicy(facts: DeployGateFacts) {
  const ev = evaluate(deployGatePolicy.rules, facts);
  const detail = deployGatePolicy.derive(facts, ev);
  return { ev, detail, decision: presentDeployGate(detail, ev) };
}
