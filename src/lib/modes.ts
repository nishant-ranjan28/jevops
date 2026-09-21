import type { FiredRule } from './jev/engine';
import { parseFields, type ValidationReport } from './jev/parse';
import {
  BUG_TRIAGE_FACT_DEFAULTS,
  bugTriageFactsSchema,
  bugTriagePolicy,
  runBugTriagePolicy,
  type BugTriageDecision,
  type BugTriageFacts,
} from './jev/policies/bug-triage';
import {
  DEPLOY_GATE_FACT_DEFAULTS,
  deployGateFactsSchema,
  deployGatePolicy,
  runDeployGatePolicy,
  type DeployGateDecision,
  type DeployGateFacts,
} from './jev/policies/deploy-gate';
import {
  PR_RISK_FACT_DEFAULTS,
  prRiskFactsSchema,
  prRiskPolicy,
  runPrRiskPolicy,
  type PrRiskDecision,
  type PrRiskFacts,
} from './jev/policies/pr-risk';
import type { ExecutedAction, FactRow, JevDecision, ModeId } from './types';

export interface ModeStageTimings {
  validateMs: number;
  decideMs: number;
  actMs: number;
}

export interface ModeRun {
  rawFacts: Record<string, unknown>;
  facts: FactRow[];
  unknowns: string[];
  /** What the schema had to repair before Jev was allowed to see the facts. */
  validation: ValidationReport;
  decision: JevDecision;
  trace: FiredRule<string>[];
  actions: ExecutedAction[];
  timings: ModeStageTimings;
}

export interface ModeSample {
  id: string;
  label: string;
  note: string;
  text: string;
}

export interface ModeDefinition {
  id: ModeId;
  label: string;
  tagline: string;
  marker: string;
  inputLabel: string;
  placeholder: string;
  policyTitle: string;
  policyId: string;
  policyVersion: string;
  ruleCount: number;
  /** Injected verbatim into the extraction prompt. */
  schemaHint: string;
  extractionGuidance: string;
  samples: ModeSample[];
  run: (raw: unknown) => ModeRun;
}

/* ---------------------------------------------------------------- helpers */

const yn = (v: boolean) => (v ? 'yes' : 'no');

/** Sub-millisecond resolution, because the deterministic layer is that fast. */
const since = (start: number) => Math.round((performance.now() - start) * 100) / 100;
const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v);

function row(
  key: string,
  label: string,
  value: string | number | null | undefined,
  known = true,
): FactRow {
  const rendered = dash(value);
  return {
    key,
    label,
    value: rendered,
    known: known && rendered !== '—' && rendered !== 'unknown',
  };
}

const list = (arr: string[]) => (arr.length ? arr.join(', ') : '—');

/* --------------------------------------------------------------- PR risk */

function prFactRows(f: PrRiskFacts): FactRow[] {
  const churn = f.linesAdded === null && f.linesRemoved === null ? null : `+${f.linesAdded ?? 0} / -${f.linesRemoved ?? 0}`;
  return [
    row('title', 'Title', f.title),
    row('changeTypes', 'Change types', list(f.changeTypes), f.changeTypes.length > 0),
    row('touchedAreas', 'Touched areas', list(f.touchedAreas), f.touchedAreas.length > 0),
    row('filesChanged', 'Files changed', f.filesChanged),
    row('churn', 'Line churn', churn),
    row('blastRadius', 'Blast radius', f.blastRadius, f.blastRadius !== 'unknown'),
    row('hasTests', 'Tests included', yn(f.hasTests)),
    row('testCoverageSignal', 'Coverage signal', f.testCoverageSignal, f.testCoverageSignal !== 'unknown'),
    row('hasDatabaseMigration', 'DB migration', yn(f.hasDatabaseMigration)),
    row('hasSchemaChange', 'Schema change', yn(f.hasSchemaChange)),
    row('touchesAuthOrCrypto', 'Auth / crypto', yn(f.touchesAuthOrCrypto)),
    row('touchesPaymentFlow', 'Payment flow', yn(f.touchesPaymentFlow)),
    row('handlesPII', 'Handles PII', yn(f.handlesPII)),
    row('addsOrUpdatesDependencies', 'Dependency change', yn(f.addsOrUpdatesDependencies)),
    row('externalApiContractChange', 'API contract change', yn(f.externalApiContractChange)),
    row('performanceSensitive', 'Perf-sensitive path', yn(f.performanceSensitive)),
    row('hasFeatureFlag', 'Feature flagged', yn(f.hasFeatureFlag)),
    row('isRollbackSafe', 'Rollback safe', f.isRollbackSafe === null ? null : yn(f.isRollbackSafe)),
  ];
}

function prActions(f: PrRiskFacts, d: PrRiskDecision): ExecutedAction[] {
  const state = d.releaseRecommendation === 'BLOCK' ? 'failure' : d.releaseRecommendation === 'HOLD' ? 'pending' : 'success';
  const actions: ExecutedAction[] = [
    {
      id: 'status-check',
      title: 'Publish commit status check',
      status: 'executed',
      detail: `jevops/risk → ${state} · ${d.riskLevel} (${d.riskScore}/100)`,
      payload: { context: 'jevops/risk', state, score: d.riskScore, level: d.riskLevel },
    },
    {
      id: 'labels',
      title: 'Apply pull-request labels',
      status: 'executed',
      detail: [
        `risk:${d.riskLevel.toLowerCase()}`,
        `release:${d.releaseRecommendation.toLowerCase().replaceAll('_', '-')}`,
        d.securityReviewRequired ? 'needs:security-review' : null,
        d.manualQaRequired ? 'needs:manual-qa' : null,
        d.e2eRequired ? 'needs:e2e' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      id: 'reviewers',
      title: 'Set required reviewer count',
      status: 'executed',
      detail: `${d.requiredReviewers} reviewer(s)${d.securityReviewRequired ? ', one from the security group' : ''}`,
      payload: { required: d.requiredReviewers },
    },
  ];

  actions.push(
    d.e2eRequired
      ? {
          id: 'e2e',
          title: 'Queue end-to-end suite',
          status: 'queued',
          detail: `Full E2E run against ${f.touchedAreas.length ? f.touchedAreas.join(', ') : 'all'} surfaces`,
        }
      : { id: 'e2e', title: 'Queue end-to-end suite', status: 'skipped', detail: 'Policy did not require an E2E run' },
  );

  if (d.releaseRecommendation === 'BLOCK' || d.releaseRecommendation === 'HOLD') {
    actions.push({
      id: 'merge-lock',
      title: 'Engage merge lock',
      status: 'executed',
      detail: 'Auto-merge disabled until the blocking policy conditions clear',
    });
  }
  return actions;
}

/* ------------------------------------------------------------ Bug triage */

function bugFactRows(f: BugTriageFacts): FactRow[] {
  return [
    row('title', 'Title', f.title),
    row('affectedArea', 'Affected area', f.affectedArea, f.affectedArea !== 'unknown'),
    row('environment', 'Environment', f.environment, f.environment !== 'unknown'),
    row('customerImpact', 'Customer impact', f.customerImpact, f.customerImpact !== 'unknown'),
    row('affectedUserEstimate', 'Users affected (est.)', f.affectedUserEstimate),
    row('reproducibility', 'Reproducibility', f.reproducibility, f.reproducibility !== 'unknown'),
    row('hasWorkaround', 'Workaround exists', yn(f.hasWorkaround)),
    row('blocksCoreWorkflow', 'Blocks core workflow', yn(f.blocksCoreWorkflow)),
    row('dataLossOrCorruption', 'Data loss / corruption', yn(f.dataLossOrCorruption)),
    row('securityImplication', 'Security implication', yn(f.securityImplication)),
    row('revenueImpacting', 'Revenue impacting', yn(f.revenueImpacting)),
    row('regressionFromRecentRelease', 'Recent regression', yn(f.regressionFromRecentRelease)),
    row('slaOrContractualRisk', 'SLA / contract risk', yn(f.slaOrContractualRisk)),
    row('reportedBy', 'Reported by', f.reportedBy, f.reportedBy !== 'unknown'),
    row('urgencySignal', 'Stated urgency', f.urgencySignal, f.urgencySignal !== 'unknown'),
  ];
}

function bugActions(f: BugTriageFacts, d: BugTriageDecision): ExecutedAction[] {
  const actions: ExecutedAction[] = [
    {
      id: 'ticket',
      title: 'Create triage ticket',
      status: 'executed',
      detail: `[${d.severity}/${d.priority}] ${f.title.slice(0, 80)} — area: ${f.affectedArea}`,
      payload: { severity: d.severity, priority: d.priority, area: f.affectedArea },
    },
    {
      id: 'sla',
      title: 'Attach response SLA timer',
      status: 'executed',
      detail: `First response due in ${d.responseSlaMinutes} minutes`,
      payload: { slaMinutes: d.responseSlaMinutes },
    },
    {
      id: 'qa',
      title: 'Select verification path',
      status: 'executed',
      detail: d.qaPath.replaceAll('_', ' ').toLowerCase(),
    },
  ];

  actions.push(
    d.pageOncall
      ? { id: 'page', title: 'Page on-call', status: 'executed', detail: `Paged: ${d.escalationTarget}` }
      : d.escalate
        ? { id: 'page', title: 'Escalate', status: 'queued', detail: `Notified: ${d.escalationTarget}` }
        : { id: 'page', title: 'Escalate', status: 'skipped', detail: 'Impact below the escalation threshold' },
  );

  if (f.securityImplication) {
    actions.push({
      id: 'embargo',
      title: 'Apply security embargo',
      status: 'executed',
      detail: 'Ticket visibility restricted to the security group',
    });
  }
  return actions;
}

/* ----------------------------------------------------------- Deploy gate */

function deployFactRows(f: DeployGateFacts): FactRow[] {
  const pct = (v: number | null) => (v === null ? null : `${v}%`);
  const ms = (v: number | null) => (v === null ? null : `${v} ms`);
  return [
    row('service', 'Service', f.service, f.service !== 'unknown-service'),
    row('environment', 'Environment', f.environment, f.environment !== 'unknown'),
    row('errorRatePct', 'Error rate', pct(f.errorRatePct)),
    row('baselineErrorRatePct', 'Baseline error rate', pct(f.baselineErrorRatePct)),
    row('p95LatencyMs', 'p95 latency', ms(f.p95LatencyMs)),
    row('baselineP95LatencyMs', 'Baseline p95', ms(f.baselineP95LatencyMs)),
    row('cpuSaturationPct', 'CPU saturation', pct(f.cpuSaturationPct)),
    row('memorySaturationPct', 'Memory saturation', pct(f.memorySaturationPct)),
    row('failedHealthChecks', 'Failed health checks', f.failedHealthChecks),
    row('activeIncidents', 'Active incidents', f.activeIncidents),
    row('recentRollbacks24h', 'Rollbacks (24h)', f.recentRollbacks24h),
    row('canaryStatus', 'Canary status', f.canaryStatus, f.canaryStatus !== 'unknown'),
    row('trafficShiftedPct', 'Traffic shifted', pct(f.trafficShiftedPct)),
    row('deployWindow', 'Deploy window', f.deployWindow, f.deployWindow !== 'unknown'),
    row('observabilityCoverage', 'Observability', f.observabilityCoverage, f.observabilityCoverage !== 'unknown'),
    row('hasRollbackPlan', 'Rollback plan', yn(f.hasRollbackPlan)),
    row('changeSize', 'Change size', f.changeSize, f.changeSize !== 'unknown'),
    row('dependencyDegradations', 'Degraded dependencies', list(f.dependencyDegradations), f.dependencyDegradations.length > 0),
  ];
}

function deployActions(f: DeployGateFacts, d: DeployGateDecision): ExecutedAction[] {
  const actions: ExecutedAction[] = [
    {
      id: 'gate',
      title: 'Write deployment gate verdict',
      status: 'executed',
      detail: `${f.service} → ${d.gate.replaceAll('_', ' ')} (pressure ${d.pressureScore}/100)`,
      payload: { service: f.service, gate: d.gate, pressure: d.pressureScore },
    },
    {
      id: 'traffic',
      title: 'Set traffic policy',
      status: 'executed',
      detail: `Traffic share capped at ${d.maxTrafficPct}%`,
      payload: { maxTrafficPct: d.maxTrafficPct },
    },
    {
      id: 'soak',
      title: 'Arm monitoring window',
      status: 'executed',
      detail: `Watching error rate and p95 for ${d.monitoringWindowMinutes} minutes`,
      payload: { minutes: d.monitoringWindowMinutes },
    },
  ];

  if (d.gate === 'ROLLBACK') {
    actions.push({
      id: 'rollback',
      title: 'Trigger rollback',
      status: 'executed',
      detail: `Reverting ${f.service} to the last known-good revision`,
    });
    actions.push({
      id: 'pipeline-freeze',
      title: 'Freeze deploy pipeline',
      status: 'executed',
      detail: `New deploys to ${f.service} blocked pending review`,
    });
  } else if (d.gate === 'HOLD') {
    actions.push({ id: 'hold', title: 'Hold rollout', status: 'executed', detail: 'Promotion paused at the current traffic split' });
  }

  actions.push(
    d.pageOncall
      ? { id: 'page', title: 'Page on-call', status: 'executed', detail: `Paged the on-call for ${f.service}` }
      : { id: 'page', title: 'Page on-call', status: 'skipped', detail: 'No paging condition met' },
  );

  return actions;
}

/* ---------------------------------------------------------------- schemas */

const PR_SCHEMA_HINT = `{
  "title": string,
  "summary": string,
  "changeTypes": ("feature"|"bugfix"|"refactor"|"config"|"dependency"|"migration"|"infra"|"docs"|"test")[],
  "touchedAreas": ("auth"|"payments"|"database"|"api"|"ui"|"build"|"ci"|"infra"|"observability"|"third-party"|"other")[],
  "filesChanged": number|null,
  "linesAdded": number|null,
  "linesRemoved": number|null,
  "hasDatabaseMigration": boolean,
  "hasSchemaChange": boolean,
  "touchesAuthOrCrypto": boolean,
  "touchesPaymentFlow": boolean,
  "handlesPII": boolean,
  "addsOrUpdatesDependencies": boolean,
  "hasFeatureFlag": boolean,
  "hasTests": boolean,
  "testCoverageSignal": "none"|"partial"|"strong"|"unknown",
  "externalApiContractChange": boolean,
  "performanceSensitive": boolean,
  "isRollbackSafe": boolean|null,
  "blastRadius": "isolated"|"module"|"service"|"system-wide"|"unknown",
  "unknowns": string[]
}`;

const BUG_SCHEMA_HINT = `{
  "title": string,
  "summary": string,
  "affectedArea": string,
  "environment": "production"|"staging"|"development"|"unknown",
  "customerImpact": "none"|"single-user"|"small-subset"|"large-subset"|"all-users"|"unknown",
  "affectedUserEstimate": number|null,
  "reproducibility": "always"|"intermittent"|"once"|"cannot-reproduce"|"unknown",
  "hasWorkaround": boolean,
  "blocksCoreWorkflow": boolean,
  "dataLossOrCorruption": boolean,
  "securityImplication": boolean,
  "revenueImpacting": boolean,
  "regressionFromRecentRelease": boolean,
  "slaOrContractualRisk": boolean,
  "reportedBy": "customer"|"internal"|"monitoring"|"unknown",
  "urgencySignal": "low"|"medium"|"high"|"critical"|"unknown",
  "unknowns": string[]
}`;

const DEPLOY_SCHEMA_HINT = `{
  "service": string,
  "environment": "production"|"staging"|"canary"|"unknown",
  "summary": string,
  "errorRatePct": number|null,
  "baselineErrorRatePct": number|null,
  "p95LatencyMs": number|null,
  "baselineP95LatencyMs": number|null,
  "cpuSaturationPct": number|null,
  "memorySaturationPct": number|null,
  "failedHealthChecks": number|null,
  "activeIncidents": number|null,
  "recentRollbacks24h": number|null,
  "canaryStatus": "healthy"|"degraded"|"failing"|"not-run"|"unknown",
  "deployWindow": "business-hours"|"off-hours"|"freeze"|"unknown",
  "trafficShiftedPct": number|null,
  "observabilityCoverage": "good"|"partial"|"none"|"unknown",
  "hasRollbackPlan": boolean,
  "changeSize": "small"|"medium"|"large"|"unknown",
  "dependencyDegradations": string[],
  "unknowns": string[]
}`;

/* --------------------------------------------------------------- registry */

export const MODES: Record<ModeId, ModeDefinition> = {
  'pr-risk': {
    id: 'pr-risk',
    label: 'PR Risk Analyzer',
    tagline: 'Turn a pull request into a release decision',
    marker: 'PR',
    inputLabel: 'Pull request title, description, or diff summary',
    placeholder:
      'feat(billing): move invoice generation to the new ledger service\n\n32 files changed, +1240 / -380.\nIncludes a migration that drops the legacy invoice_totals column...',
    policyTitle: prRiskPolicy.title,
    policyId: prRiskPolicy.id,
    policyVersion: prRiskPolicy.version,
    ruleCount: prRiskPolicy.rules.length,
    schemaHint: PR_SCHEMA_HINT,
    extractionGuidance:
      'Read the pull request like a staff engineer doing review triage. Record only what the text supports. Anything you cannot determine goes into "unknowns" and keeps its null/false/"unknown" default.',
    samples: [
      {
        id: 'ledger-migration',
        label: 'Billing migration',
        note: 'Forces a HOLD despite a confident description',
        text: `feat(billing): move invoice generation to the new ledger service

This one is pretty straightforward and has been running in my branch for a week, so it should be safe to merge.

32 files changed, +1240 / -380 lines.
Includes a database migration that drops the legacy invoice_totals column and backfills the new ledger_entries table. The migration cannot be rolled back once the column is dropped.
Touches the payment and checkout flow end to end. No tests added yet - I'll follow up next sprint.
Not behind a feature flag because the old path is being deleted in the same PR.`,
      },
      {
        id: 'auth-refactor',
        label: 'Auth refactor',
        note: 'Security review forced by policy',
        text: `refactor(auth): replace session cookie handling with JWT

Small cleanup, mostly moving code around.

8 files changed, +210 / -260.
Rewrites the login and session validation path, rotates the token signing key, and changes how the refresh token is stored.
Unit tests updated. No e2e coverage on the login flow yet.
Shared library used by every service.`,
      },
      {
        id: 'docs-tweak',
        label: 'Docs tweak',
        note: 'The low-risk baseline',
        text: `docs: fix broken links in the onboarding README

1 file changed, +6 / -6. Documentation only, no code paths touched. Easily reverted.`,
      },
    ],
    run: (raw) => {
      const validateStart = performance.now();
      const { value: facts, validation } = parseFields(prRiskFactsSchema, PR_RISK_FACT_DEFAULTS, raw);
      const validateMs = since(validateStart);

      const decideStart = performance.now();
      const { ev, detail, decision } = runPrRiskPolicy(facts);
      const decideMs = since(decideStart);

      const actStart = performance.now();
      const actions = prActions(facts, detail);
      const actMs = since(actStart);

      return {
        rawFacts: facts as unknown as Record<string, unknown>,
        facts: prFactRows(facts),
        unknowns: facts.unknowns,
        validation,
        decision,
        trace: ev.fired,
        actions,
        timings: { validateMs, decideMs, actMs },
      };
    },
  },

  'bug-triage': {
    id: 'bug-triage',
    label: 'Bug Triage',
    tagline: 'Turn a bug report into severity, priority, and a QA path',
    marker: 'BUG',
    inputLabel: 'Bug report, support ticket, or incident note',
    placeholder:
      'Customer reports that checkout fails with a 500 after entering card details. Started this morning, affects roughly 400 accounts on the enterprise plan...',
    policyTitle: bugTriagePolicy.title,
    policyId: bugTriagePolicy.id,
    policyVersion: bugTriagePolicy.version,
    ruleCount: bugTriagePolicy.rules.length,
    schemaHint: BUG_SCHEMA_HINT,
    extractionGuidance:
      'Read the report like a triage engineer. Do not infer severity or priority — that is not your job. Extract only observable facts and list everything the reporter left out under "unknowns".',
    samples: [
      {
        id: 'checkout-500',
        label: 'Checkout failures',
        note: 'Revenue + SLA pressure escalates it',
        text: `Checkout returns a 500 after card entry

A customer on the enterprise plan raised a support ticket this morning. Payment submission fails every time with a 500 on production. Roughly 1200 accounts have hit the error according to the dashboard.
There is no workaround - users cannot complete a purchase at all. This started after the release yesterday afternoon.
Our contract with them has an uptime SLA.`,
      },
      {
        id: 'silent-data',
        label: 'Silent data corruption',
        note: 'Quiet wording, severe policy outcome',
        text: `Minor: export occasionally writes the wrong rows

Low priority I think. A few users noticed the CSV export in reporting sometimes contains records from another tenant, and some of their own rows are missing from the file. It happens intermittently in production.
Not urgent, nobody has complained loudly. Support has been telling people to retry the export.`,
      },
      {
        id: 'cosmetic',
        label: 'Cosmetic glitch',
        note: 'Stays in the backlog',
        text: `Dashboard chart legend overlaps on narrow screens

Cosmetic only, seen once on a local development build by a QA engineer. There is a workaround - resizing the window fixes it. Single user, no data involved.`,
      },
    ],
    run: (raw) => {
      const validateStart = performance.now();
      const { value: facts, validation } = parseFields(bugTriageFactsSchema, BUG_TRIAGE_FACT_DEFAULTS, raw);
      const validateMs = since(validateStart);

      const decideStart = performance.now();
      const { ev, detail, decision } = runBugTriagePolicy(facts);
      const decideMs = since(decideStart);

      const actStart = performance.now();
      const actions = bugActions(facts, detail);
      const actMs = since(actStart);

      return {
        rawFacts: facts as unknown as Record<string, unknown>,
        facts: bugFactRows(facts),
        unknowns: facts.unknowns,
        validation,
        decision,
        trace: ev.fired,
        actions,
        timings: { validateMs, decideMs, actMs },
      };
    },
  },

  'deploy-gate': {
    id: 'deploy-gate',
    label: 'Deployment Gate',
    tagline: 'Allow, hold, or roll back — against hard thresholds',
    marker: 'DEP',
    inputLabel: 'Deployment metrics, rollout notes, or on-call chatter',
    placeholder:
      'Rolling out checkout-api v4.12 to production. Error rate 2.4% against a 0.3% baseline, p95 at 940 ms, canary degraded...',
    policyTitle: deployGatePolicy.title,
    policyId: deployGatePolicy.id,
    policyVersion: deployGatePolicy.version,
    ruleCount: deployGatePolicy.rules.length,
    schemaHint: DEPLOY_SCHEMA_HINT,
    extractionGuidance:
      'Read the rollout report like an SRE. Pull every number out literally — never round, never smooth, never editorialise. If a metric is absent, leave it null and name it in "unknowns".',
    samples: [
      {
        id: 'error-rate-breach',
        label: 'Error rate breach',
        note: 'The headline demo: LLM says ship, Jev says BLOCK',
        text: `Deploying checkout-api v4.12 to production.

Rollout has been going fine for 20 minutes and the team is happy with it. Most of the fleet is healthy and the change itself is small.
Error rate is sitting at 2.4% versus a 0.3% baseline. p95 latency is 910 ms against a 620 ms baseline. CPU is at 71%.
Canary looked healthy before we widened traffic. 100% of traffic is on the new version now.
We have dashboards and alerting in place, and a rollback plan to the previous revision.
Nobody has complained yet so we are inclined to let it bake.`,
      },
      {
        id: 'freeze-window',
        label: 'Change freeze',
        note: 'Process rule holds an otherwise healthy deploy',
        text: `Deploying notifications-service v2.3 to production during the holiday change freeze.

Metrics all look clean: error rate 0.1% against a 0.1% baseline, p95 at 120 ms versus a 130 ms baseline, CPU 40%, memory 55%.
Canary is healthy, 10% of traffic shifted. Dashboards and alerting in place, rollback plan documented.
It's a small config-only change and the requesting team says it's urgent.`,
      },
      {
        id: 'clean-rollout',
        label: 'Clean rollout',
        note: 'What ALLOW looks like',
        text: `Deploying search-api v1.9 to production.

Error rate 0.08% against a 0.09% baseline. p95 at 180 ms versus a 190 ms baseline. CPU 42%, memory 51%.
Canary is healthy after 30 minutes. 10% of traffic shifted. Zero active incidents, no rollbacks in the last 24 hours.
Full dashboards, alerting and tracing in place. Rollback plan to the known-good revision is documented. Small change, deployed off-hours.`,
      },
    ],
    run: (raw) => {
      const validateStart = performance.now();
      const { value: facts, validation } = parseFields(deployGateFactsSchema, DEPLOY_GATE_FACT_DEFAULTS, raw);
      const validateMs = since(validateStart);

      const decideStart = performance.now();
      const { ev, detail, decision } = runDeployGatePolicy(facts);
      const decideMs = since(decideStart);

      const actStart = performance.now();
      const actions = deployActions(facts, detail);
      const actMs = since(actStart);

      return {
        rawFacts: facts as unknown as Record<string, unknown>,
        facts: deployFactRows(facts),
        unknowns: facts.unknowns,
        validation,
        decision,
        trace: ev.fired,
        actions,
        timings: { validateMs, decideMs, actMs },
      };
    },
  },
};

export const MODE_LIST: ModeDefinition[] = [MODES['pr-risk'], MODES['bug-triage'], MODES['deploy-gate']];
