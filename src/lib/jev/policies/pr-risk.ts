import { z } from 'zod';
import {
  anyOf,
  evaluate,
  has,
  type JevEvaluation,
  type JevPolicy,
  type JevRule,
} from '../engine';
import type { DecisionField, JevDecision, Stance, Veto } from '../../types';

/* ------------------------------------------------------------------ facts */

export const prRiskFactsSchema = z.object({
  title: z.string(),
  summary: z.string(),
  changeTypes: z
    .array(z.enum(['feature', 'bugfix', 'refactor', 'config', 'dependency', 'migration', 'infra', 'docs', 'test']))
    ,
  touchedAreas: z
    .array(z.enum(['auth', 'payments', 'database', 'api', 'ui', 'build', 'ci', 'infra', 'observability', 'third-party', 'other']))
    ,
  filesChanged: z.number().int().nonnegative().nullable(),
  linesAdded: z.number().int().nonnegative().nullable(),
  linesRemoved: z.number().int().nonnegative().nullable(),
  hasDatabaseMigration: z.boolean(),
  hasSchemaChange: z.boolean(),
  touchesAuthOrCrypto: z.boolean(),
  touchesPaymentFlow: z.boolean(),
  handlesPII: z.boolean(),
  addsOrUpdatesDependencies: z.boolean(),
  hasFeatureFlag: z.boolean(),
  hasTests: z.boolean(),
  testCoverageSignal: z.enum(['none', 'partial', 'strong', 'unknown']),
  externalApiContractChange: z.boolean(),
  performanceSensitive: z.boolean(),
  isRollbackSafe: z.boolean().nullable(),
  blastRadius: z.enum(['isolated', 'module', 'service', 'system-wide', 'unknown']),
  unknowns: z.array(z.string()),
});

export type PrRiskFacts = z.infer<typeof prRiskFactsSchema>;

export const PR_RISK_FACT_DEFAULTS: PrRiskFacts = {
  title: 'Untitled change',
  summary: '',
  changeTypes: [],
  touchedAreas: [],
  filesChanged: null,
  linesAdded: null,
  linesRemoved: null,
  hasDatabaseMigration: false,
  hasSchemaChange: false,
  touchesAuthOrCrypto: false,
  touchesPaymentFlow: false,
  handlesPII: false,
  addsOrUpdatesDependencies: false,
  hasFeatureFlag: false,
  hasTests: false,
  testCoverageSignal: 'unknown',
  externalApiContractChange: false,
  performanceSensitive: false,
  isRollbackSafe: null,
  blastRadius: 'unknown',
  unknowns: [],
};


/* ------------------------------------------------------------------ flags */

export type PrRiskFlag =
  | 'security-review'
  | 'manual-qa'
  | 'e2e'
  | 'flag-required'
  | 'staged-rollout'
  | 'hold'
  | 'migration'
  | 'no-tests'
  | 'wide-blast'
  | 'rollback-unsafe'
  | 'contract-change'
  | 'perf-watch'
  | 'dependency-audit'
  | 'low-risk';

/** Tunable thresholds. Swap this object to re-tune the policy without touching rules. */
export const PR_RISK_THRESHOLDS = {
  criticalScore: 70,
  highScore: 45,
  moderateScore: 22,
  blockScore: 80,
  holdScore: 62,
  stagedRolloutScore: 45,
  featureFlagScore: 25,
  autoE2eScore: 55,
  largeDiffFiles: 40,
  mediumDiffFiles: 15,
  largeDiffLines: 800,
  mediumDiffLines: 300,
} as const;

const T = PR_RISK_THRESHOLDS;

const churn = (f: PrRiskFacts) => (f.linesAdded ?? 0) + (f.linesRemoved ?? 0);

/** Documentation and test-only changes carry no product-code test obligation. */
const docsOnly = (f: PrRiskFacts) =>
  f.changeTypes.length > 0 &&
  f.changeTypes.every((t) => t === 'docs' || t === 'test') &&
  !f.hasDatabaseMigration;

/* ------------------------------------------------------------------ rules */

export const prRiskRules: readonly JevRule<PrRiskFacts, PrRiskFlag>[] = [
  {
    id: 'PR-SEC-001',
    label: 'Change touches authentication or cryptography code',
    category: 'security',
    weight: 22,
    flags: ['security-review', 'manual-qa'],
    when: (f) => f.touchesAuthOrCrypto || f.touchedAreas.includes('auth'),
  },
  {
    id: 'PR-SEC-002',
    label: 'Change touches the payment flow',
    category: 'security',
    weight: 20,
    flags: ['security-review', 'manual-qa', 'e2e'],
    when: (f) => f.touchesPaymentFlow || f.touchedAreas.includes('payments'),
  },
  {
    id: 'PR-SEC-003',
    label: 'Change handles personally identifiable information',
    category: 'security',
    weight: 14,
    flags: ['security-review'],
    when: (f) => f.handlesPII,
  },
  {
    id: 'PR-SEC-004',
    label: 'Dependencies added or upgraded — supply-chain surface changed',
    category: 'security',
    weight: 8,
    flags: ['dependency-audit'],
    when: (f) => f.addsOrUpdatesDependencies || f.changeTypes.includes('dependency'),
  },
  {
    id: 'PR-DATA-001',
    label: 'Database migration included',
    category: 'operational',
    weight: 18,
    flags: ['migration', 'manual-qa', 'staged-rollout'],
    when: (f) => f.hasDatabaseMigration || f.changeTypes.includes('migration'),
  },
  {
    id: 'PR-DATA-002',
    label: 'Schema change is not confirmed rollback-safe',
    category: 'operational',
    weight: 14,
    flags: ['rollback-unsafe', 'hold'],
    when: (f) => f.hasSchemaChange && f.isRollbackSafe !== true,
  },
  {
    id: 'PR-DATA-003',
    label: 'Author flagged the change as not rollback-safe',
    category: 'operational',
    weight: 12,
    flags: ['rollback-unsafe'],
    when: (f) => f.isRollbackSafe === false,
  },
  {
    id: 'PR-API-001',
    label: 'External API contract changed — downstream consumers affected',
    category: 'blast-radius',
    weight: 15,
    flags: ['contract-change', 'e2e'],
    when: (f) => f.externalApiContractChange,
  },
  {
    id: 'PR-BLAST-001',
    label: 'Blast radius is system-wide',
    category: 'blast-radius',
    weight: 20,
    flags: ['wide-blast', 'staged-rollout', 'e2e'],
    when: (f) => f.blastRadius === 'system-wide',
  },
  {
    id: 'PR-BLAST-002',
    label: 'Blast radius spans a whole service',
    category: 'blast-radius',
    weight: 12,
    flags: ['wide-blast'],
    when: (f) => f.blastRadius === 'service',
  },
  {
    id: 'PR-BLAST-003',
    label: 'Infrastructure or CI configuration modified',
    category: 'operational',
    weight: 8,
    flags: ['manual-qa'],
    when: (f) => f.touchedAreas.includes('infra') || f.touchedAreas.includes('ci') || f.changeTypes.includes('infra'),
  },
  {
    id: 'PR-TEST-001',
    label: 'No tests accompany the change',
    category: 'coverage',
    weight: 16,
    flags: ['no-tests', 'manual-qa'],
    when: (f) => !f.hasTests && !docsOnly(f),
  },
  {
    id: 'PR-TEST-002',
    label: 'Test coverage for the changed paths is absent',
    category: 'coverage',
    weight: 10,
    flags: ['no-tests'],
    when: (f) => f.testCoverageSignal === 'none' && !docsOnly(f),
  },
  {
    id: 'PR-TEST-003',
    label: 'Test coverage for the changed paths is only partial',
    category: 'coverage',
    weight: 5,
    when: (f) => f.testCoverageSignal === 'partial',
  },
  {
    id: 'PR-TEST-004',
    label: 'Strong test coverage reported alongside the change',
    category: 'coverage',
    weight: -8,
    when: (f) => f.hasTests && f.testCoverageSignal === 'strong',
  },
  {
    id: 'PR-SIZE-001',
    label: `Large diff — more than ${T.largeDiffFiles} files changed`,
    category: 'blast-radius',
    weight: 10,
    when: (f) => (f.filesChanged ?? 0) > T.largeDiffFiles,
  },
  {
    id: 'PR-SIZE-002',
    label: `Medium diff — more than ${T.mediumDiffFiles} files changed`,
    category: 'blast-radius',
    weight: 5,
    when: (f) => {
      const n = f.filesChanged ?? 0;
      return n > T.mediumDiffFiles && n <= T.largeDiffFiles;
    },
  },
  {
    id: 'PR-SIZE-003',
    label: `High churn — more than ${T.largeDiffLines} lines touched`,
    category: 'blast-radius',
    weight: 10,
    when: (f) => churn(f) > T.largeDiffLines,
  },
  {
    id: 'PR-SIZE-004',
    label: `Moderate churn — more than ${T.mediumDiffLines} lines touched`,
    category: 'blast-radius',
    weight: 5,
    when: (f) => churn(f) > T.mediumDiffLines && churn(f) <= T.largeDiffLines,
  },
  {
    id: 'PR-PERF-001',
    label: 'Change sits on a performance-sensitive path',
    category: 'reliability',
    weight: 9,
    flags: ['perf-watch', 'e2e'],
    when: (f) => f.performanceSensitive,
  },
  {
    id: 'PR-REL-001',
    label: 'Wide-reaching change ships without a feature flag',
    category: 'reliability',
    weight: 8,
    flags: ['flag-required'],
    when: (f) => !f.hasFeatureFlag && (f.blastRadius === 'service' || f.blastRadius === 'system-wide'),
  },
  {
    id: 'PR-REL-002',
    label: 'Change is guarded by a feature flag',
    category: 'reliability',
    weight: -6,
    when: (f) => f.hasFeatureFlag,
  },
  {
    id: 'PR-PROC-001',
    label: 'Extraction left three or more material facts unknown',
    category: 'process',
    weight: 6,
    when: (f) => f.unknowns.length >= 3,
  },
  {
    id: 'PR-PROC-002',
    label: 'Documentation or test-only change',
    category: 'process',
    weight: -15,
    flags: ['low-risk'],
    when: docsOnly,
  },
];

/* --------------------------------------------------------------- decision */

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type RegressionRisk = 'LOW' | 'MODERATE' | 'HIGH';
export type ReleaseRecommendation =
  | 'SHIP'
  | 'SHIP_BEHIND_FLAG'
  | 'STAGED_ROLLOUT'
  | 'HOLD'
  | 'BLOCK';

export interface PrRiskDecision {
  riskScore: number;
  riskLevel: RiskLevel;
  regressionRisk: RegressionRisk;
  manualQaRequired: boolean;
  e2eRequired: boolean;
  securityReviewRequired: boolean;
  releaseRecommendation: ReleaseRecommendation;
  requiredReviewers: number;
  requiredActions: string[];
  veto: Veto | null;
}

function riskLevel(score: number): RiskLevel {
  if (score >= T.criticalScore) return 'CRITICAL';
  if (score >= T.highScore) return 'HIGH';
  if (score >= T.moderateScore) return 'MODERATE';
  return 'LOW';
}

function regressionRisk(score: number, ev: JevEvaluation<PrRiskFlag>): RegressionRisk {
  const amplifiers = anyOf(ev, 'no-tests', 'wide-blast', 'migration', 'contract-change');
  if (score >= T.highScore && amplifiers) return 'HIGH';
  if (score >= T.moderateScore || amplifiers) return 'MODERATE';
  return 'LOW';
}

function releaseRecommendation(
  score: number,
  ev: JevEvaluation<PrRiskFlag>,
): ReleaseRecommendation {
  const unsafeMigration = has(ev, 'rollback-unsafe') && has(ev, 'migration') && has(ev, 'no-tests');
  if (score >= T.blockScore || unsafeMigration) return 'BLOCK';
  if (score >= T.holdScore || has(ev, 'hold')) return 'HOLD';
  if (score >= T.stagedRolloutScore || has(ev, 'staged-rollout')) return 'STAGED_ROLLOUT';
  if (score >= T.featureFlagScore || has(ev, 'flag-required')) return 'SHIP_BEHIND_FLAG';
  return 'SHIP';
}

/**
 * A veto is a condition that decides the outcome by itself, independent of the
 * aggregate score. Surfacing it by name is the whole argument for this layer.
 */
function prVeto(ev: JevEvaluation<PrRiskFlag>): Veto | null {
  if (has(ev, 'rollback-unsafe') && has(ev, 'migration') && has(ev, 'no-tests')) {
    const rule = ev.fired.find((r) => r.id === 'PR-DATA-002' || r.id === 'PR-DATA-003');
    return {
      ruleId: rule?.id ?? 'PR-DATA-002',
      label: 'Irreversible migration shipping without test coverage',
      threshold: 'rollback-unsafe + migration + no-tests ⇒ BLOCK, whatever the score says',
    };
  }
  if (ev.score >= T.blockScore) {
    return {
      ruleId: 'PR-THRESHOLD',
      label: `Aggregate risk score reached ${ev.score}`,
      threshold: `risk score ≥ ${T.blockScore} ⇒ BLOCK`,
    };
  }
  return null;
}

const STANCE_BY_RELEASE: Record<ReleaseRecommendation, Stance> = {
  SHIP: 'PROCEED',
  SHIP_BEHIND_FLAG: 'PROCEED_WITH_GUARDRAILS',
  STAGED_ROLLOUT: 'PROCEED_WITH_GUARDRAILS',
  HOLD: 'HOLD',
  BLOCK: 'BLOCK',
};

export const prRiskPolicy: JevPolicy<PrRiskFacts, PrRiskFlag, PrRiskDecision> = {
  id: 'jev.pr-risk',
  version: '1.2.0',
  title: 'Pull Request Risk Policy',
  rules: prRiskRules,
  derive(facts, ev) {
    const score = ev.score;
    const release = releaseRecommendation(score, ev);
    const securityReviewRequired = has(ev, 'security-review');
    const manualQaRequired = has(ev, 'manual-qa') || score >= T.highScore;
    const e2eRequired = has(ev, 'e2e') || score >= T.autoE2eScore;

    const requiredActions: string[] = [];
    if (securityReviewRequired) requiredActions.push('Request sign-off from the security review group');
    if (manualQaRequired) requiredActions.push('Assign a manual QA pass on the affected surfaces');
    if (e2eRequired) requiredActions.push('Run the full end-to-end suite before merge');
    if (has(ev, 'migration')) requiredActions.push('Rehearse the migration on a production-shaped snapshot');
    if (has(ev, 'rollback-unsafe')) requiredActions.push('Document and verify an explicit rollback path');
    if (has(ev, 'flag-required')) requiredActions.push('Wrap the change in a feature flag before merge');
    if (has(ev, 'contract-change')) requiredActions.push('Notify downstream consumers of the contract change');
    if (has(ev, 'dependency-audit')) requiredActions.push('Run a dependency audit on the new package set');
    if (has(ev, 'perf-watch')) requiredActions.push('Capture a performance baseline before and after rollout');
    if (requiredActions.length === 0) requiredActions.push('Standard single-reviewer merge — no extra gates');

    return {
      riskScore: score,
      riskLevel: riskLevel(score),
      regressionRisk: regressionRisk(score, ev),
      manualQaRequired,
      e2eRequired,
      securityReviewRequired,
      releaseRecommendation: release,
      requiredReviewers: 1 + (securityReviewRequired ? 1 : 0) + (score >= T.holdScore ? 1 : 0),
      requiredActions,
      veto: prVeto(ev),
    };
  },
};

const toneForRisk = (level: RiskLevel): DecisionField['tone'] =>
  level === 'CRITICAL' ? 'bad' : level === 'HIGH' ? 'warn' : level === 'MODERATE' ? 'neutral' : 'good';

const boolTone = (v: boolean): DecisionField['tone'] => (v ? 'warn' : 'good');

export function presentPrRisk(d: PrRiskDecision, ev: JevEvaluation<PrRiskFlag>): JevDecision {
  return {
    stance: STANCE_BY_RELEASE[d.releaseRecommendation],
    headline: d.releaseRecommendation.replaceAll('_', ' '),
    score: d.riskScore,
    scoreLabel: 'Risk score',
    severityLabel: d.riskLevel,
    policyId: prRiskPolicy.id,
    policyVersion: prRiskPolicy.version,
    rulesEvaluated: ev.rulesEvaluated,
    veto: d.veto,
    requiredActions: d.requiredActions,
    fields: [
      { label: 'Risk level', value: d.riskLevel, tone: toneForRisk(d.riskLevel) },
      {
        label: 'Regression risk',
        value: d.regressionRisk,
        tone: d.regressionRisk === 'HIGH' ? 'bad' : d.regressionRisk === 'MODERATE' ? 'warn' : 'good',
      },
      { label: 'Manual QA', value: d.manualQaRequired ? 'REQUIRED' : 'Not required', tone: boolTone(d.manualQaRequired) },
      { label: 'E2E suite', value: d.e2eRequired ? 'REQUIRED' : 'Not required', tone: boolTone(d.e2eRequired) },
      {
        label: 'Security review',
        value: d.securityReviewRequired ? 'REQUIRED' : 'Not required',
        tone: d.securityReviewRequired ? 'bad' : 'good',
      },
      { label: 'Reviewers needed', value: String(d.requiredReviewers), tone: 'neutral' },
      {
        label: 'Release',
        value: d.releaseRecommendation.replaceAll('_', ' '),
        tone: d.releaseRecommendation === 'BLOCK' ? 'bad' : d.releaseRecommendation === 'SHIP' ? 'good' : 'warn',
      },
      {
        label: 'Hard veto',
        value: d.veto?.ruleId ?? 'None',
        tone: d.veto ? 'bad' : 'good',
        hint: d.veto?.threshold,
      },
    ],
  };
}

export function runPrRiskPolicy(facts: PrRiskFacts) {
  const ev = evaluate(prRiskPolicy.rules, facts);
  const detail = prRiskPolicy.derive(facts, ev);
  return { ev, detail, decision: presentPrRisk(detail, ev) };
}
