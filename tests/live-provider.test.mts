/**
 * End-to-end verification of the LIVE provider path.
 *
 * A local OpenAI-compatible server stands in for OpenRouter/Groq, so the real
 * transport, auth header, JSON extraction, schema gate, Jev policy and
 * explanation call all execute exactly as they do against a hosted model.
 * What is NOT covered here is the hosted vendors' own availability.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { runAnalysis } from '../src/lib/pipeline';
import type { AnalysisEvent, AnalysisResult } from '../src/lib/types';

interface CapturedRequest {
  path: string;
  authorization: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: {
    model?: string;
    messages?: { role: string; content: string }[];
    response_format?: { type: string };
    temperature?: number;
  };
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[] = [];

/** Set per test: how the fake model answers the extraction call. */
let extractionResponse: string | null = null;
/** Set per test: force a transport failure. */
let failWith: number | null = null;
/** Set per test: reject only requests that ask for JSON mode. */
let rejectJsonMode = false;

const BREACHING_DEPLOY = `Deploying checkout-api v4.12 to production.
Error rate is 2.4% versus a 0.3% baseline. 100% of traffic is on the new version.`;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({
        path: req.url ?? '',
        authorization: req.headers.authorization,
        headers: req.headers,
        body,
      });

      if (failWith) {
        res.writeHead(failWith, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream exploded' } }));
        return;
      }

      if (rejectJsonMode && body.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Failed to validate JSON.' } }));
        return;
      }

      const messages = (body.messages ?? []) as { role: string; content: string }[];
      const isExtraction = messages.some((m) => m.content.includes('extraction stage'));
      const content = isExtraction
        ? (extractionResponse ?? '{}')
        : 'The policy blocked this because the measured error rate crossed a fixed ceiling.';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  requests = [];
  failWith = null;
  rejectJsonMode = false;
  extractionResponse = null;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_BASE_URL;
  delete process.env.GROQ_MODEL;
  delete process.env.LLM_PROVIDER;
});

function useGroq() {
  process.env.LLM_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
}

function useOpenRouter() {
  process.env.LLM_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = baseUrl;
  process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
}

async function analyze(mode: 'deploy-gate' | 'pr-risk', input: string) {
  const events: AnalysisEvent[] = [];
  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({ mode, input })) {
    events.push(event);
    if (event.type === 'result') result = event.result;
  }
  assert.ok(result, 'pipeline must always emit a result');
  return { events, result };
}

const deployFacts = (overrides: Record<string, unknown> = {}) => ({
  service: 'checkout-api',
  environment: 'production',
  summary: 'rollout',
  errorRatePct: 2.4,
  baselineErrorRatePct: 0.3,
  p95LatencyMs: 910,
  baselineP95LatencyMs: 620,
  cpuSaturationPct: 71,
  memorySaturationPct: null,
  failedHealthChecks: 0,
  activeIncidents: 0,
  recentRollbacks24h: 0,
  canaryStatus: 'healthy',
  deployWindow: 'business-hours',
  trafficShiftedPct: 100,
  observabilityCoverage: 'good',
  hasRollbackPlan: true,
  changeSize: 'small',
  dependencyDegradations: [],
  unknowns: [],
  ...overrides,
});

const envelope = (facts: Record<string, unknown>, stance = 'PROCEED') =>
  JSON.stringify({
    facts,
    recommendation: { stance, headline: 'Ship it', rationale: 'Reads fine.', confidence: 0.8 },
    extractionConfidence: 0.9,
  });

/* --------------------------------------------------------------- the path */

test('Groq: the live path runs end to end and is reported as LIVE', async () => {
  useGroq();
  extractionResponse = envelope(deployFacts());

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'live');
  assert.equal(result.meta.provider, 'groq');
  assert.equal(result.meta.model, 'llama-3.3-70b-versatile');
  assert.equal(requests.length, 2, 'one extraction call and one explanation call');
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer test-groq-key');
  assert.equal(requests[0].body.model, 'llama-3.3-70b-versatile');
  assert.equal(requests[0].body.response_format?.type, 'json_object');
  assert.equal(requests[0].body.temperature, 0, 'extraction must be deterministic');
  assert.match(result.explanation, /fixed ceiling/, 'explanation came from the live model');
});

test('OpenRouter: same transport, its own key, model and attribution headers', async () => {
  useOpenRouter();
  extractionResponse = envelope(deployFacts());

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'live');
  assert.equal(result.meta.provider, 'openrouter');
  assert.equal(requests[0].authorization, 'Bearer test-or-key');
  assert.equal(requests[0].body.model, 'anthropic/claude-3.5-sonnet');
  assert.equal(requests[0].headers['x-title'], 'JevOps');
});

/* ------------------------------------------------- the model cannot decide */

test('a live model recommending PROCEED cannot stop Jev from blocking', async () => {
  useGroq();
  extractionResponse = envelope(deployFacts(), 'PROCEED');

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.llm.stance, 'PROCEED', 'the model opinion is recorded');
  assert.equal(result.decision.stance, 'BLOCK', 'and overruled');
  assert.equal(result.decision.headline, 'ROLLBACK');
  assert.equal(result.decision.veto?.ruleId, 'DEP-ERR-001');
  assert.equal(result.divergence.agree, false);
  assert.equal(result.divergence.delta, 3);
});

test('a live model inventing a stance outside the enum is repaired, not obeyed', async () => {
  useGroq();
  extractionResponse = JSON.stringify({
    facts: deployFacts(),
    recommendation: { stance: 'SHIP_IT_NOW', headline: 'go', rationale: '', confidence: 2 },
    extractionConfidence: 0.9,
  });

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.ok(
    result.validation.repairs.some((r) => r.field === 'recommendation'),
    'the bad recommendation must be recorded as a repair',
  );
  assert.equal(result.llm.stance, 'PROCEED_WITH_GUARDRAILS', 'defaulted, not passed through');
  assert.equal(result.decision.headline, 'ROLLBACK');
});

test('invalid fact values from a live model are defaulted before Jev sees them', async () => {
  useGroq();
  extractionResponse = envelope(
    deployFacts({ canaryStatus: 'on fire', errorRatePct: 'very high', changeSize: 42 }),
  );

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  const repaired = result.validation.repairs.map((r) => r.field);
  assert.deepEqual(repaired.sort(), [
    'facts.canaryStatus',
    'facts.changeSize',
    'facts.errorRatePct',
  ]);
  assert.equal(result.rawFacts.canaryStatus, 'unknown');
  assert.equal(result.rawFacts.errorRatePct, null);
  assert.ok(result.decision, 'a decision is still produced from the surviving facts');
});

test('a live model wrapping JSON in prose still reaches Jev intact', async () => {
  useGroq();
  extractionResponse = `Here you go!\n\`\`\`json\n${envelope(deployFacts())}\n\`\`\`\nLet me know.`;

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.validation.repairs.length, 0);
  assert.equal(result.rawFacts.errorRatePct, 2.4);
  assert.equal(result.decision.headline, 'ROLLBACK');
});

/* ------------------------------------------------------------- resilience */

test('a provider outage falls back to mock, says so, and still decides', async () => {
  useGroq();
  failWith = 500;

  const { events, result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'mock');
  assert.match(result.meta.provider, /mock fallback/);
  assert.ok(
    events.some((e) => e.type === 'error' && /groq extraction failed/.test(e.message)),
    'the failure is surfaced, not swallowed',
  );
  // The analyze stage still completes — via the mock — so it is reported as
  // done, with the outage named in its detail rather than a bare "failed".
  const analyzeDone = events.find(
    (e) => e.type === 'stage' && e.stage === 'analyze' && e.status === 'done',
  );
  assert.ok(analyzeDone && analyzeDone.type === 'stage');
  assert.match(analyzeDone.detail ?? '', /mock/);
  assert.match(analyzeDone.detail ?? '', /groq unavailable/);
  assert.equal(result.decision.headline, 'ROLLBACK', 'the decision still lands');
});

test('with no key configured the pipeline reports MOCK, not a silent live claim', async () => {
  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);
  assert.equal(result.meta.source, 'mock');
  assert.equal(requests.length, 0, 'no network call is attempted');
});

/* ------------------------------------------------------------- the stages */

test('the six pipeline stages all start and complete, in order', async () => {
  useGroq();
  extractionResponse = envelope(deployFacts());

  const { events } = await analyze('deploy-gate', BREACHING_DEPLOY);
  const completed = events
    .filter((e) => e.type === 'stage' && e.status === 'done')
    .map((e) => (e.type === 'stage' ? e.stage : ''));

  assert.deepEqual(completed, ['input', 'analyze', 'facts', 'decide', 'act', 'explain']);
});

test('a provider error surfaces its message, not the raw body with account ids', async () => {
  useGroq();
  failWith = 404;

  const { events } = await analyze('deploy-gate', BREACHING_DEPLOY);
  const error = events.find((e) => e.type === 'error');
  assert.ok(error && error.type === 'error');
  assert.match(error.message, /upstream exploded/, 'the provider reason is kept');
  assert.ok(!error.message.includes('{'), 'the raw JSON body is not passed through');
});

test('a per-request model override reaches the provider without a restart', async () => {
  useGroq();
  extractionResponse = envelope(deployFacts());

  const events: AnalysisEvent[] = [];
  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({
    mode: 'deploy-gate',
    input: BREACHING_DEPLOY,
    modelOverride: 'some-other-model',
  })) {
    events.push(event);
    if (event.type === 'result') result = event.result;
  }

  assert.ok(result);
  assert.equal(requests[0].body.model, 'some-other-model', 'the override is what gets sent');
  assert.equal(result.meta.model, 'some-other-model', 'and what the UI reports');
  assert.equal(result.meta.source, 'live');
});

/* ------------------------------------------------------------- failover */

test('when the primary provider fails the secondary serves the run', async () => {
  // OpenRouter points at a dead port; Groq points at the working fake.
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.GROQ_MODEL = 'groq-standby-model';
  extractionResponse = envelope(deployFacts());

  const { events, result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'live', 'the run stays live');
  assert.match(result.meta.provider, /groq/);
  assert.equal(result.meta.model, 'groq-standby-model');
  assert.match(result.meta.reason, /openrouter unavailable/i);
  assert.ok(
    events.some((e) => e.type === 'error' && /openrouter extraction failed/.test(e.message)),
    'the primary failure is surfaced, not hidden',
  );
  assert.equal(result.decision.headline, 'ROLLBACK');
});

test('the fallback provider uses its own model, not the primary model override', async () => {
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.GROQ_MODEL = 'groq-own-model';
  extractionResponse = envelope(deployFacts());

  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({
    mode: 'deploy-gate',
    input: BREACHING_DEPLOY,
    providerOverride: 'openrouter',
    modelOverride: 'a-model-only-openrouter-has',
  })) {
    if (event.type === 'result') result = event.result;
  }

  assert.ok(result);
  assert.equal(
    result.meta.model,
    'groq-own-model',
    'a model id meant for one provider must not be sent to another',
  );
  assert.equal(requests[0].body.model, 'groq-own-model');
});

test('when every live provider fails the mock closes the chain', async () => {
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_BASE_URL = 'http://127.0.0.1:2/v1';

  const { events, result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'mock');
  assert.match(result.meta.provider, /openrouter → groq → mock fallback/);
  const failures = events.filter((e) => e.type === 'error');
  assert.equal(failures.length, 2, 'both provider failures are reported');
  assert.equal(result.decision.headline, 'ROLLBACK', 'the decision still lands');
});

test('the standby provider is named up front, before anything fails', async () => {
  useGroq();
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  extractionResponse = envelope(deployFacts());

  const { events } = await analyze('deploy-gate', BREACHING_DEPLOY);
  const first = events.find((e) => e.type === 'meta');
  assert.ok(first && first.type === 'meta');
  assert.match(first.meta.reason, /standby/i);
});

test('a provider that rejects JSON mode is retried in plain mode before failover', async () => {
  useGroq();
  // Reject only the JSON-mode request, exactly as Groq does on long prompts.
  rejectJsonMode = true;
  extractionResponse = `Here is the analysis:\n\`\`\`json\n${envelope(deployFacts())}\n\`\`\``;

  const { events, result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.source, 'live');
  assert.equal(result.meta.provider, 'groq', 'no failover was needed');
  assert.equal(requests.length, 3, 'json attempt, plain attempt, then the explanation');
  assert.equal(requests[0].body.response_format?.type, 'json_object');
  assert.equal(requests[1].body.response_format, undefined, 'the retry drops JSON mode');
  assert.equal(result.validation.repairs.length, 0, 'prose-wrapped JSON still parses');
  assert.equal(result.decision.headline, 'ROLLBACK');
  assert.ok(!events.some((e) => e.type === 'error'), 'a recovered provider raises no error');
});

test('meta records every provider turn, which is what the UI draws', async () => {
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.GROQ_MODEL = 'groq-standby-model';
  extractionResponse = envelope(deployFacts());

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);

  assert.equal(result.meta.servedBy, 'groq', 'the plain id of whoever answered');
  assert.deepEqual(
    result.meta.attempts.map((a) => [a.provider, a.status]),
    [
      ['openrouter', 'failed'],
      ['groq', 'ok'],
    ],
  );
  assert.ok(result.meta.attempts[0].error, 'the failure carries its reason');
  assert.equal(result.meta.attempts[1].error, undefined);
});

test('a clean run records a single successful attempt', async () => {
  useGroq();
  extractionResponse = envelope(deployFacts());

  const { result } = await analyze('deploy-gate', BREACHING_DEPLOY);
  assert.equal(result.meta.servedBy, 'groq');
  assert.deepEqual(result.meta.attempts, [{ provider: 'groq', status: 'ok' }]);
});
