/**
 * Deterministic stand-in for a hosted model.
 *
 * It exists so the whole pipeline — extraction, Jev, actions, explanation —
 * runs with zero API keys and produces the same output every time, which is
 * exactly what you want on stage. It is keyword-driven, not intelligent, and
 * deliberately over-optimistic in its recommendation: that is what makes the
 * LLM-vs-Jev divergence visible in the demo.
 */
import type { LlmRecommendation, ModeId, Stance } from '../types';

export interface MockExtraction {
  raw: Record<string, unknown>;
  llm: LlmRecommendation;
  extractionConfidence: number;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

function num(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const group = match.slice(1).find((g) => g !== undefined);
  if (group === undefined) return null;
  const parsed = Number(group.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** First pattern that yields a number wins. */
function firstNum(text: string, ...patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const value = num(text, pattern);
    if (value !== null) return value;
  }
  return null;
}

/** Explicit zeros ("no active incidents") are facts, not missing data. */
function countOrZero(text: string, pattern: RegExp, zeroPattern: RegExp): number | null {
  const value = num(text, pattern);
  if (value !== null) return value;
  return zeroPattern.test(text) ? 0 : null;
}

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return (line ?? 'Untitled').replace(/^#+\s*/, '').slice(0, 140);
}

function optimism(text: string): Stance {
  if (has(text, /\b(outage|data loss|breach|cannot be rolled back|catastroph)\b/i)) return 'HOLD';
  if (has(text, /\b(revert|roll ?back now|stop the deploy)\b/i)) return 'HOLD';
  return 'PROCEED';
}

/* ----------------------------------------------------------- PR risk mock */

function mockPrRisk(input: string): MockExtraction {
  const t = input.toLowerCase();
  const unknowns: string[] = [];

  const filesChanged = num(input, /(\d[\d,]*)\s*files?\s*(?:changed|modified|touched)/i);
  const linesAdded = num(input, /\+\s*(\d[\d,]*)|(\d[\d,]*)\s*insertions?/i);
  const linesRemoved = num(input, /-\s*(\d[\d,]*)\s*(?:lines|deletions)|(\d[\d,]*)\s*deletions?/i);
  if (filesChanged === null) unknowns.push('filesChanged');
  if (linesAdded === null) unknowns.push('linesAdded');

  const hasTests = has(t, /\b(test|spec|coverage|vitest|jest|pytest)\b/);
  const hasDatabaseMigration = has(t, /\b(migration|alter table|drop column|backfill|schema migration)\b/);
  const touchesAuthOrCrypto = has(t, /\b(auth|login|session|jwt|oauth|token|password|encrypt|crypto)\b/);
  const touchesPaymentFlow = has(t, /\b(payment|billing|stripe|checkout|invoice|refund|subscription)\b/);

  const blastRadius = has(t, /\b(platform-wide|all services|shared library|core module|every service)\b/)
    ? 'system-wide'
    : has(t, /\b(service|backend|api|gateway)\b/)
      ? 'service'
      : has(t, /\b(single component|isolated|one file|self-contained)\b/)
        ? 'isolated'
        : 'module';

  const isRollbackSafe = has(t, /\b(cannot be rolled back|irreversible|not reversible|no rollback|destructive)\b/)
    ? false
    : has(t, /\b(rollback safe|reversible|easily reverted)\b/)
      ? true
      : null;
  if (isRollbackSafe === null) unknowns.push('isRollbackSafe');

  const testCoverageSignal = has(t, /\b(no tests|without tests|untested|skipped tests)\b/)
    ? 'none'
    : has(t, /\b(full coverage|comprehensive tests|well tested)\b/)
      ? 'strong'
      : hasTests
        ? 'partial'
        : 'none';

  // A conventional-commit prefix is a far stronger signal than loose keywords.
  const conventional = input
    .match(/^\s*(docs|test|chore|ci|build|feat|fix|refactor|perf|style)(\([^)]*\))?!?:/i)?.[1]
    ?.toLowerCase();
  const CONVENTIONAL_TYPE: Record<string, string> = {
    docs: 'docs',
    test: 'test',
    feat: 'feature',
    fix: 'bugfix',
    refactor: 'refactor',
    perf: 'refactor',
    chore: 'config',
    ci: 'infra',
    build: 'config',
    style: 'refactor',
  };

  const typeSet = new Set<string>();
  if (conventional) typeSet.add(CONVENTIONAL_TYPE[conventional]);
  // A "docs:" or "test:" commit is exactly that — do not let stray keywords widen it.
  if (conventional !== 'docs' && conventional !== 'test') {
    if (has(t, /\b(feature|add|introduce|new endpoint)\b/)) typeSet.add('feature');
    if (has(t, /\b(fix|bug|patch)\b/)) typeSet.add('bugfix');
    if (has(t, /\b(refactor|cleanup|rename)\b/)) typeSet.add('refactor');
    if (hasDatabaseMigration) typeSet.add('migration');
    if (has(t, /\b(dependency|package\.json|upgrade|bump)\b/)) typeSet.add('dependency');
    if (has(t, /\b(infra|terraform|kubernetes|helm|dockerfile)\b/)) typeSet.add('infra');
    if (has(t, /\b(docs|readme|documentation)\b/)) typeSet.add('docs');
  }
  const changeTypes = [...typeSet];

  const touchedAreas: string[] = [];
  if (touchesAuthOrCrypto) touchedAreas.push('auth');
  if (touchesPaymentFlow) touchedAreas.push('payments');
  if (hasDatabaseMigration || has(t, /\b(database|postgres|mysql|query|sql)\b/)) touchedAreas.push('database');
  if (has(t, /\b(api|endpoint|route|graphql)\b/)) touchedAreas.push('api');
  if (has(t, /\b(ui|component|css|frontend|react)\b/)) touchedAreas.push('ui');
  if (has(t, /\b(ci|pipeline|workflow|github action)\b/)) touchedAreas.push('ci');
  if (has(t, /\b(infra|terraform|kubernetes|helm)\b/)) touchedAreas.push('infra');
  if (touchedAreas.length === 0) touchedAreas.push('other');

  return {
    raw: {
      title: firstLine(input),
      summary: input.slice(0, 400),
      changeTypes,
      touchedAreas,
      filesChanged,
      linesAdded,
      linesRemoved,
      hasDatabaseMigration,
      // Narrow on purpose: a filename like index.js must not read as a
      // schema change. Only database-specific phrasing counts.
      hasSchemaChange:
        hasDatabaseMigration ||
        has(
          t,
          /\b(schema change|schema migration|alter table|add column|drop column|rename column|create index|drop index|add constraint|foreign key)\b/,
        ),
      touchesAuthOrCrypto,
      touchesPaymentFlow,
      handlesPII: has(t, /\b(pii|personal data|gdpr|email address|phone number|ssn)\b/),
      addsOrUpdatesDependencies: has(t, /\b(dependency|dependencies|package\.json|upgrade|bump|lockfile)\b/),
      hasFeatureFlag: has(t, /\b(feature flag|behind a flag|flag-gated|launchdarkly|killswitch)\b/),
      hasTests,
      testCoverageSignal,
      externalApiContractChange: has(t, /\b(breaking change|api contract|response shape|remove.*field|rename.*field|v2 endpoint)\b/),
      performanceSensitive: has(t, /\b(performance|latency|hot path|n\+1|throughput|optimi)\b/),
      isRollbackSafe,
      blastRadius,
      unknowns,
    },
    llm: {
      stance: optimism(input),
      headline: optimism(input) === 'PROCEED' ? 'Looks mergeable' : 'Worth a second look',
      rationale:
        'Surface reading of the description suggests a contained change with a clear intent. The author appears confident and the summary reads as routine.',
      confidence: 0.74,
    },
    extractionConfidence: 0.78,
  };
}

/* -------------------------------------------------------- Bug triage mock */

function mockBugTriage(input: string): MockExtraction {
  const t = input.toLowerCase();
  const unknowns: string[] = [];

  const affectedUserEstimate = num(input, /(\d[\d,]*)\s*(?:users|customers|accounts|tenants)/i);
  if (affectedUserEstimate === null) unknowns.push('affectedUserEstimate');

  const environment = has(t, /\b(prod|production|live)\b/)
    ? 'production'
    : has(t, /\bstaging\b/)
      ? 'staging'
      : has(t, /\b(local|dev|development)\b/)
        ? 'development'
        : 'unknown';
  if (environment === 'unknown') unknowns.push('environment');

  const customerImpact = has(t, /\b(all users|everyone|every customer|entire user base|全部)\b/)
    ? 'all-users'
    : has(t, /\b(many users|thousands|hundreds|widespread|most users)\b/)
      ? 'large-subset'
      : has(t, /\b(some users|a few|handful|subset)\b/)
        ? 'small-subset'
        : has(t, /\b(one user|single customer|one customer)\b/)
          ? 'single-user'
          : (affectedUserEstimate ?? 0) > 500
            ? 'large-subset'
            : 'unknown';
  if (customerImpact === 'unknown') unknowns.push('customerImpact');

  const reproducibility = has(t, /\b(every time|always|consistently|100% repro)\b/)
    ? 'always'
    : has(t, /\b(intermittent|sometimes|occasionally|flaky|random)\b/)
      ? 'intermittent'
      : has(t, /\b(cannot reproduce|could not reproduce|not reproducible)\b/)
        ? 'cannot-reproduce'
        : has(t, /\b(once|one time|single occurrence)\b/)
          ? 'once'
          : 'unknown';
  if (reproducibility === 'unknown') unknowns.push('reproducibility');

  const area =
    input.match(/\b(checkout|login|auth|search|dashboard|billing|upload|notification|export|reporting|onboarding)\b/i)?.[0] ??
    'unknown';
  if (area === 'unknown') unknowns.push('affectedArea');

  return {
    raw: {
      title: firstLine(input),
      summary: input.slice(0, 400),
      affectedArea: area.toLowerCase(),
      environment,
      customerImpact,
      affectedUserEstimate,
      reproducibility,
      hasWorkaround: has(t, /\bworkaround\b/) && !has(t, /\bno workaround\b/),
      blocksCoreWorkflow: has(t, /\b(cannot|can't|unable to|blocked|completely broken|hard stop)\b/),
      dataLossOrCorruption: has(
        t,
        /\b(data loss|corrupt|lost data|missing records|missing rows|rows are missing|wrong rows|wrong records|deleted|overwritten|records from another)\b/,
      ),
      securityImplication: has(
        t,
        /\b(security|vulnerab|leak|exposed|unauthori[sz]ed|injection|xss|csrf|another tenant|cross-tenant|other tenants?)\b/,
      ),
      revenueImpacting: has(t, /\b(revenue|payment|checkout|billing|cannot pay|failed charge|subscription)\b/),
      regressionFromRecentRelease: has(t, /\b(regression|since the (release|deploy)|worked before|used to work|after the update)\b/),
      slaOrContractualRisk: has(t, /\b(sla|contract|enterprise customer|penalt|breach of)\b/),
      reportedBy: has(t, /\b(customer|client|user reported|support ticket)\b/)
        ? 'customer'
        : has(t, /\b(alert|sentry|datadog|pagerduty|monitor|dashboard fired)\b/)
          ? 'monitoring'
          : has(t, /\b(qa|internal|engineer noticed)\b/)
            ? 'internal'
            : 'unknown',
      urgencySignal: has(t, /\b(critical|urgent|p0|asap|emergency)\b/)
        ? 'critical'
        : has(t, /\b(high priority|important|soon)\b/)
          ? 'high'
          : has(t, /\b(minor|cosmetic|low priority|nit)\b/)
            ? 'low'
            : 'medium',
      unknowns,
    },
    llm: {
      stance: has(t, /\b(data loss|security|all users|outage)\b/) ? 'HOLD' : 'PROCEED_WITH_GUARDRAILS',
      headline: has(t, /\b(data loss|security|all users|outage)\b/) ? 'Serious — escalate' : 'Normal bug, queue it',
      rationale:
        'Read as prose, the report describes a defect with a bounded description and no explicit emergency language, so the natural instinct is to queue it behind current work.',
      confidence: 0.71,
    },
    extractionConfidence: 0.76,
  };
}

/* ------------------------------------------------------ Deploy gate mock */

function mockDeployGate(input: string): MockExtraction {
  const t = input.toLowerCase();
  const unknowns: string[] = [];

  const errorRatePct = num(input, /error[ _-]?rate[^0-9%]*([\d.]+)\s*%/i);
  const baselineErrorRatePct = firstNum(
    input,
    /(?:versus|vs\.?|against|compared to)\s*(?:an?\s*)?([\d.]+)\s*%\s*baseline/i,
    /baseline[^0-9%.\n]*([\d.]+)\s*%/i,
  );
  const p95LatencyMs = num(input, /p9[59][^0-9]*([\d.]+)\s*ms/i);
  const baselineP95LatencyMs = firstNum(
    input,
    /(?:versus|vs\.?|against|compared to)\s*(?:an?\s*)?([\d.]+)\s*ms\s*baseline/i,
    /baseline[^0-9.\n]*p9[59][^0-9]*([\d.]+)\s*ms/i,
  );
  const cpuSaturationPct = num(input, /cpu[^0-9%]*([\d.]+)\s*%/i);
  const memorySaturationPct = num(input, /mem(?:ory)?[^0-9%]*([\d.]+)\s*%/i);
  const failedHealthChecks = countOrZero(
    input,
    /(\d+)\s*(?:of\s*\d+\s*)?health ?checks?\s*(?:are\s*)?fail/i,
    /\b(?:no|zero)\s+(?:failed\s+)?health ?checks?|health ?checks?\s+(?:are\s+)?(?:all\s+)?(?:passing|green|healthy)/i,
  );
  const activeIncidents = countOrZero(
    input,
    /(\d+)\s*(?:active|open|ongoing)?\s*incident/i,
    /\b(?:no|zero)\s+(?:active|open|ongoing)?\s*incidents?/i,
  );
  const recentRollbacks24h = countOrZero(
    input,
    /(\d+)\s*rollbacks?/i,
    /\b(?:no|zero)\s+rollbacks?/i,
  );
  const trafficShiftedPct = num(input, /(\d[\d.]*)\s*%\s*(?:of\s*(?:the\s*)?)?(?:traffic|fleet)/i);

  if (errorRatePct === null) unknowns.push('errorRatePct');
  if (p95LatencyMs === null) unknowns.push('p95LatencyMs');
  if (activeIncidents === null) unknowns.push('activeIncidents');

  const canaryStatus = has(t, /canary[^.\n]*(fail|red|aborted)/)
    ? 'failing'
    : has(t, /canary[^.\n]*(degrad|warn|amber|elevated)/)
      ? 'degraded'
      : has(t, /canary[^.\n]*(healthy|green|passing|clean)/)
        ? 'healthy'
        : has(t, /\bno canary|canary not run|skipped canary\b/)
          ? 'not-run'
          : 'unknown';

  const service = input.match(/\b(?:service|deploy(?:ing)?|rollout of)\s+([a-z0-9][a-z0-9-_.]{2,})/i)?.[1] ?? 'unknown-service';

  return {
    raw: {
      service,
      environment: has(t, /\b(prod|production)\b/) ? 'production' : has(t, /\bcanary\b/) ? 'canary' : has(t, /\bstaging\b/) ? 'staging' : 'unknown',
      summary: input.slice(0, 400),
      errorRatePct,
      baselineErrorRatePct,
      p95LatencyMs,
      baselineP95LatencyMs,
      cpuSaturationPct,
      memorySaturationPct,
      failedHealthChecks,
      activeIncidents,
      recentRollbacks24h,
      canaryStatus,
      deployWindow: has(t, /\b(freeze|code freeze|change freeze|embargo)\b/)
        ? 'freeze'
        : has(t, /\b(off-hours|overnight|weekend|maintenance window)\b/)
          ? 'off-hours'
          : has(t, /\b(business hours|peak traffic|midday)\b/)
            ? 'business-hours'
            : 'unknown',
      trafficShiftedPct,
      observabilityCoverage: has(t, /\b(no dashboards|no alerting|no metrics|blind)\b/)
        ? 'none'
        : has(t, /\b(partial (?:metrics|coverage)|limited telemetry|some dashboards)\b/)
          ? 'partial'
          : has(t, /\b(dashboards|alerting|tracing|full telemetry|metrics in place)\b/)
            ? 'good'
            : 'unknown',
      hasRollbackPlan: has(t, /\b(rollback plan|revert plan|known-good revision|blue-?green)\b/),
      changeSize: has(t, /\b(large|major|big bang|monolithic release)\b/)
        ? 'large'
        : has(t, /\b(small|minor|one-line|config only)\b/)
          ? 'small'
          : 'medium',
      dependencyDegradations: /\b(degrad|down|unavailable)\b/.test(t)
        ? (input.match(/\b([a-z0-9-]+(?:-service|-api|-db|-cache))\b/gi) ?? []).slice(0, 3)
        : [],
      unknowns,
    },
    llm: {
      stance: has(t, /\b(roll ?back now|abort|halt)\b/) ? 'HOLD' : 'PROCEED',
      headline: has(t, /\b(roll ?back now|abort|halt)\b/) ? 'Consider pausing' : 'Ship it',
      rationale:
        'The narrative reads as a rollout that is broadly progressing. Individual numbers are mentioned but, read as a story rather than against thresholds, nothing screams stop.',
      confidence: 0.69,
    },
    extractionConfidence: 0.72,
  };
}

const MOCKS: Record<ModeId, (input: string) => MockExtraction> = {
  'pr-risk': mockPrRisk,
  'bug-triage': mockBugTriage,
  'deploy-gate': mockDeployGate,
};

export function mockExtract(mode: ModeId, input: string): MockExtraction {
  return MOCKS[mode](input);
}
