import { z } from 'zod';
import { anyOf, evaluate, has, type JevEvaluation, type JevPolicy, type JevRule } from '../engine';
import type { DecisionField, JevDecision, Stance, Veto } from '../../types';

/* ------------------------------------------------------------------ facts */

export const bugTriageFactsSchema = z.object({
  title: z.string(),
  summary: z.string(),
  affectedArea: z.string(),
  environment: z.enum(['production', 'staging', 'development', 'unknown']),
  customerImpact: z
    .enum(['none', 'single-user', 'small-subset', 'large-subset', 'all-users', 'unknown'])
    ,
  affectedUserEstimate: z.number().int().nonnegative().nullable(),
  reproducibility: z.enum(['always', 'intermittent', 'once', 'cannot-reproduce', 'unknown']),
  hasWorkaround: z.boolean(),
  blocksCoreWorkflow: z.boolean(),
  dataLossOrCorruption: z.boolean(),
  securityImplication: z.boolean(),
  revenueImpacting: z.boolean(),
  regressionFromRecentRelease: z.boolean(),
  slaOrContractualRisk: z.boolean(),
  reportedBy: z.enum(['customer', 'internal', 'monitoring', 'unknown']),
  urgencySignal: z.enum(['low', 'medium', 'high', 'critical', 'unknown']),
  unknowns: z.array(z.string()),
});

export type BugTriageFacts = z.infer<typeof bugTriageFactsSchema>;

export const BUG_TRIAGE_FACT_DEFAULTS: BugTriageFacts = {
  title: 'Untitled bug report',
  summary: '',
  affectedArea: 'unknown',
  environment: 'unknown',
  customerImpact: 'unknown',
  affectedUserEstimate: null,
  reproducibility: 'unknown',
  hasWorkaround: false,
  blocksCoreWorkflow: false,
  dataLossOrCorruption: false,
  securityImplication: false,
  revenueImpacting: false,
  regressionFromRecentRelease: false,
  slaOrContractualRisk: false,
  reportedBy: 'unknown',
  urgencySignal: 'unknown',
  unknowns: [],
};


/* ------------------------------------------------------------------ flags */

export type BugTriageFlag =
  | 'page-oncall'
  | 'escalate'
  | 'hotfix'
  | 'security-triage'
  | 'data-recovery'
  | 'needs-repro'
  | 'regression-owner'
  | 'customer-comms'
  | 'backlog';

export const BUG_TRIAGE_THRESHOLDS = {
  s1Score: 72,
  s2Score: 48,
  s3Score: 24,
  pageScore: 78,
  escalateScore: 55,
  largeBlastUsers: 500,
  mediumBlastUsers: 50,
} as const;

const T = BUG_TRIAGE_THRESHOLDS;

/* ------------------------------------------------------------------ rules */

export const bugTriageRules: readonly JevRule<BugTriageFacts, BugTriageFlag>[] = [
  {
    id: 'BUG-ENV-001',
    label: 'Defect is live in production',
    category: 'impact',
    weight: 18,
    when: (f) => f.environment === 'production',
  },
  {
    id: 'BUG-ENV-002',
    label: 'Defect is confined to a pre-production environment',
    category: 'impact',
    weight: -10,
    flags: ['backlog'],
    when: (f) => f.environment === 'development' || f.environment === 'staging',
  },
  {
    id: 'BUG-IMP-001',
    label: 'Every user is affected',
    category: 'impact',
    weight: 26,
    flags: ['escalate', 'customer-comms'],
    when: (f) => f.customerImpact === 'all-users',
  },
  {
    id: 'BUG-IMP-002',
    label: 'A large subset of users is affected',
    category: 'impact',
    weight: 18,
    flags: ['customer-comms'],
    when: (f) => f.customerImpact === 'large-subset',
  },
  {
    id: 'BUG-IMP-003',
    label: 'A small subset of users is affected',
    category: 'impact',
    weight: 8,
    when: (f) => f.customerImpact === 'small-subset',
  },
  {
    id: 'BUG-IMP-004',
    label: `Estimated blast radius exceeds ${T.largeBlastUsers} users`,
    category: 'impact',
    weight: 12,
    flags: ['customer-comms'],
    when: (f) => (f.affectedUserEstimate ?? 0) > T.largeBlastUsers,
  },
  {
    id: 'BUG-IMP-005',
    label: 'Core user workflow is blocked outright',
    category: 'impact',
    weight: 16,
    flags: ['escalate'],
    when: (f) => f.blocksCoreWorkflow,
  },
  {
    id: 'BUG-IMP-006',
    label: 'Revenue path is impacted',
    category: 'impact',
    weight: 16,
    flags: ['escalate', 'customer-comms'],
    when: (f) => f.revenueImpacting,
  },
  {
    id: 'BUG-RISK-001',
    label: 'Data loss or corruption is in play',
    category: 'reliability',
    weight: 28,
    flags: ['page-oncall', 'data-recovery', 'escalate'],
    when: (f) => f.dataLossOrCorruption,
  },
  {
    id: 'BUG-RISK-002',
    label: 'Report carries a security implication',
    category: 'security',
    weight: 24,
    flags: ['security-triage', 'escalate'],
    when: (f) => f.securityImplication,
  },
  {
    id: 'BUG-RISK-003',
    label: 'Contractual or SLA breach is at risk',
    category: 'process',
    weight: 14,
    flags: ['escalate', 'customer-comms'],
    when: (f) => f.slaOrContractualRisk,
  },
  {
    id: 'BUG-REG-001',
    label: 'Defect is a regression from a recent release',
    category: 'reliability',
    weight: 14,
    flags: ['regression-owner', 'hotfix'],
    when: (f) => f.regressionFromRecentRelease,
  },
  {
    id: 'BUG-REPRO-001',
    label: 'Defect reproduces every time',
    category: 'reliability',
    weight: 8,
    when: (f) => f.reproducibility === 'always',
  },
  {
    id: 'BUG-REPRO-002',
    label: 'Defect is intermittent — root cause will be harder to pin down',
    category: 'reliability',
    weight: 5,
    flags: ['needs-repro'],
    when: (f) => f.reproducibility === 'intermittent',
  },
  {
    id: 'BUG-REPRO-003',
    label: 'Defect could not be reproduced',
    category: 'reliability',
    weight: -12,
    flags: ['needs-repro'],
    when: (f) => f.reproducibility === 'cannot-reproduce',
  },
  {
    id: 'BUG-MIT-001',
    label: 'A workaround exists for affected users',
    category: 'impact',
    weight: -12,
    when: (f) => f.hasWorkaround,
  },
  {
    id: 'BUG-MIT-002',
    label: 'No workaround while a core workflow is blocked',
    category: 'impact',
    weight: 10,
    flags: ['escalate'],
    when: (f) => !f.hasWorkaround && f.blocksCoreWorkflow,
  },
  {
    id: 'BUG-SRC-001',
    label: 'Reported by a customer rather than caught internally',
    category: 'process',
    weight: 6,
    flags: ['customer-comms'],
    when: (f) => f.reportedBy === 'customer',
  },
  {
    id: 'BUG-SRC-002',
    label: 'Raised by production monitoring',
    category: 'operational',
    weight: 6,
    when: (f) => f.reportedBy === 'monitoring',
  },
  {
    id: 'BUG-PROC-001',
    label: 'Reporter marked the issue as critical',
    category: 'process',
    weight: 6,
    when: (f) => f.urgencySignal === 'critical',
  },
  {
    id: 'BUG-PROC-002',
    label: 'Three or more material facts are missing from the report',
    category: 'process',
    weight: 5,
    flags: ['needs-repro'],
    when: (f) => f.unknowns.length >= 3,
  },
];

/* --------------------------------------------------------------- decision */

export type Severity = 'S1' | 'S2' | 'S3' | 'S4';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type QaPath =
  | 'BACKLOG_VERIFICATION'
  | 'TARGETED_REGRESSION'
  | 'FULL_REGRESSION_PLUS_E2E'
  | 'HOTFIX_VERIFICATION_WITH_PROD_SMOKE';

export interface BugTriageDecision {
  impactScore: number;
  severity: Severity;
  priority: Priority;
  escalate: boolean;
  escalationTarget: string;
  pageOncall: boolean;
  qaPath: QaPath;
  responseSlaMinutes: number;
  requiredActions: string[];
  veto: Veto | null;
}

function severityOf(score: number): Severity {
  if (score >= T.s1Score) return 'S1';
  if (score >= T.s2Score) return 'S2';
  if (score >= T.s3Score) return 'S3';
  return 'S4';
}

const PRIORITY_BY_SEVERITY: Record<Severity, Priority> = { S1: 'P0', S2: 'P1', S3: 'P2', S4: 'P3' };
const SLA_BY_PRIORITY: Record<Priority, number> = { P0: 15, P1: 240, P2: 1440, P3: 10080 };

function qaPathOf(sev: Severity, ev: JevEvaluation<BugTriageFlag>): QaPath {
  if (has(ev, 'hotfix') || sev === 'S1') return 'HOTFIX_VERIFICATION_WITH_PROD_SMOKE';
  if (sev === 'S2' || anyOf(ev, 'data-recovery', 'security-triage')) return 'FULL_REGRESSION_PLUS_E2E';
  if (sev === 'S3') return 'TARGETED_REGRESSION';
  return 'BACKLOG_VERIFICATION';
}

/** Conditions that set the outcome on their own, ignoring the aggregate score. */
function bugVeto(ev: JevEvaluation<BugTriageFlag>): Veto | null {
  if (has(ev, 'data-recovery')) {
    return {
      ruleId: 'BUG-RISK-001',
      label: 'Data loss or corruption is in play',
      threshold: 'data loss ⇒ page on-call, whatever urgency the reporter stated',
    };
  }
  if (has(ev, 'security-triage')) {
    return {
      ruleId: 'BUG-RISK-002',
      label: 'Report carries a security implication',
      threshold: 'security implication ⇒ escalate to security triage under embargo',
    };
  }
  if (ev.score >= T.pageScore) {
    return {
      ruleId: 'BUG-THRESHOLD',
      label: `Aggregate impact score reached ${ev.score}`,
      threshold: `impact score ≥ ${T.pageScore} ⇒ page on-call`,
    };
  }
  return null;
}

const STANCE_BY_PRIORITY: Record<Priority, Stance> = {
  P0: 'BLOCK',
  P1: 'HOLD',
  P2: 'PROCEED_WITH_GUARDRAILS',
  P3: 'PROCEED',
};

export const bugTriagePolicy: JevPolicy<BugTriageFacts, BugTriageFlag, BugTriageDecision> = {
  id: 'jev.bug-triage',
  version: '1.1.0',
  title: 'Bug Triage Policy',
  rules: bugTriageRules,
  derive(facts, ev) {
    const score = ev.score;
    const severity = severityOf(score);
    const priority = PRIORITY_BY_SEVERITY[severity];
    const pageOncall = score >= T.pageScore || has(ev, 'page-oncall');
    const escalate = pageOncall || score >= T.escalateScore || has(ev, 'escalate');

    const escalationTarget = has(ev, 'security-triage')
      ? 'Security incident response'
      : has(ev, 'data-recovery')
        ? 'Data platform on-call + incident commander'
        : pageOncall
          ? 'Service on-call (page)'
          : escalate
            ? 'Engineering manager for the owning team'
            : 'None — normal queue';

    const requiredActions: string[] = [];
    if (pageOncall) requiredActions.push('Page the on-call engineer immediately');
    if (has(ev, 'data-recovery')) requiredActions.push('Open a data-integrity incident and snapshot affected records');
    if (has(ev, 'security-triage')) requiredActions.push('Route to security triage under embargo');
    if (has(ev, 'customer-comms')) requiredActions.push('Draft customer-facing status communication');
    if (has(ev, 'regression-owner')) requiredActions.push('Identify the introducing release and assign its author');
    if (has(ev, 'hotfix')) requiredActions.push('Prepare a hotfix branch off the current release tag');
    if (has(ev, 'needs-repro')) requiredActions.push('Collect reproduction steps, traces, and session identifiers');
    if (requiredActions.length === 0) requiredActions.push('File into the normal backlog with the derived priority');

    return {
      impactScore: score,
      severity,
      priority,
      escalate,
      escalationTarget,
      pageOncall,
      qaPath: qaPathOf(severity, ev),
      responseSlaMinutes: SLA_BY_PRIORITY[priority],
      requiredActions,
      veto: bugVeto(ev),
    };
  },
};

function formatSla(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

const sevTone = (s: Severity): DecisionField['tone'] =>
  s === 'S1' ? 'bad' : s === 'S2' ? 'warn' : s === 'S3' ? 'neutral' : 'good';

export function presentBugTriage(
  d: BugTriageDecision,
  ev: JevEvaluation<BugTriageFlag>,
): JevDecision {
  return {
    stance: STANCE_BY_PRIORITY[d.priority],
    headline: `${d.severity} / ${d.priority}`,
    score: d.impactScore,
    scoreLabel: 'Impact score',
    severityLabel: d.severity,
    policyId: bugTriagePolicy.id,
    policyVersion: bugTriagePolicy.version,
    rulesEvaluated: ev.rulesEvaluated,
    veto: d.veto,
    requiredActions: d.requiredActions,
    fields: [
      { label: 'Severity', value: d.severity, tone: sevTone(d.severity) },
      { label: 'Priority', value: d.priority, tone: sevTone(d.severity) },
      { label: 'Escalation', value: d.escalate ? 'REQUIRED' : 'Not required', tone: d.escalate ? 'warn' : 'good' },
      { label: 'Route to', value: d.escalationTarget, tone: 'neutral' },
      { label: 'Page on-call', value: d.pageOncall ? 'YES' : 'No', tone: d.pageOncall ? 'bad' : 'good' },
      { label: 'QA path', value: d.qaPath.replaceAll('_', ' '), tone: 'neutral' },
      { label: 'Response SLA', value: formatSla(d.responseSlaMinutes), tone: d.responseSlaMinutes <= 60 ? 'warn' : 'neutral' },
      {
        label: 'Hard veto',
        value: d.veto?.ruleId ?? 'None',
        tone: d.veto ? 'bad' : 'good',
        hint: d.veto?.threshold,
      },
    ],
  };
}

export function runBugTriagePolicy(facts: BugTriageFacts) {
  const ev = evaluate(bugTriagePolicy.rules, facts);
  const detail = bugTriagePolicy.derive(facts, ev);
  return { ev, detail, decision: presentBugTriage(detail, ev) };
}
