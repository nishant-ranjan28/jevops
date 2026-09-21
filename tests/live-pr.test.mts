/**
 * The live pull-request review path, end to end.
 *
 * Two local servers stand in for GitHub and the LLM provider, so the real
 * fetch → extract → schema → Jev → action → explain sequence executes, and
 * every failure mode can be provoked deterministically.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { runAnalysis } from '../src/lib/pipeline';
import type { AnalysisEvent, AnalysisResult } from '../src/lib/types';

let github: Server;
let llm: Server;
let githubUrl: string;
let llmUrl: string;

/** Per-test control over what the fake GitHub returns. */
let githubStatus = 200;
let githubHeaders: Record<string, string> = {};
let githubBody: unknown = null;
let githubFiles: unknown = null;
let githubCalls: string[] = [];

/** Per-test control over the fake model. */
let extractionResponse: string | null = null;
let extractionResponses: string[] = [];
let llmStatus = 200;
let llmCalls: { messages: { role: string; content: string }[] }[] = [];

const PR_URL = 'https://github.com/acme/payments/pull/412';

const PULL = {
  number: 412,
  title: 'Refactor payment processing',
  body: 'Moves invoice generation onto the new ledger. Should be safe.',
  state: 'open',
  draft: false,
  merged: false,
  user: { login: 'dana' },
  base: { ref: 'main' },
  head: { ref: 'feat/ledger' },
  changed_files: 14,
  additions: 342,
  deletions: 87,
};

const FILES = [
  {
    filename: 'src/payments/charge.ts',
    status: 'modified',
    additions: 120,
    deletions: 30,
    changes: 150,
    patch: '@@ -1,4 +1,4 @@\n-const x = 1\n+const x = 2\n',
  },
  {
    filename: 'migrations/2024_drop_totals.sql',
    status: 'added',
    additions: 40,
    deletions: 0,
    changes: 40,
    patch: '@@\n+ALTER TABLE invoices DROP COLUMN totals;\n',
  },
];

const PR_FACTS = {
  title: 'Refactor payment processing',
  summary: 'Moves invoice generation onto the new ledger.',
  changeTypes: ['refactor', 'migration'],
  touchedAreas: ['payments', 'database'],
  filesChanged: 14,
  linesAdded: 342,
  linesRemoved: 87,
  hasDatabaseMigration: true,
  hasSchemaChange: true,
  touchesAuthOrCrypto: false,
  touchesPaymentFlow: true,
  handlesPII: false,
  addsOrUpdatesDependencies: false,
  hasFeatureFlag: false,
  hasTests: false,
  testCoverageSignal: 'none',
  externalApiContractChange: false,
  performanceSensitive: false,
  isRollbackSafe: false,
  blastRadius: 'service',
  unknowns: [],
};

const envelope = (facts: Record<string, unknown>, stance = 'PROCEED') =>
  JSON.stringify({
    facts,
    recommendation: {
      stance,
      headline: 'Likely safe to merge',
      rationale: 'The description reads as a routine refactor.',
      confidence: 0.82,
    },
    extractionConfidence: 0.9,
  });

before(async () => {
  github = createServer((req, res) => {
    githubCalls.push(req.url ?? '');
    if (githubStatus !== 200) {
      res.writeHead(githubStatus, { 'Content-Type': 'application/json', ...githubHeaders });
      res.end(JSON.stringify({ message: 'nope' }));
      return;
    }
    const payload = (req.url ?? '').includes('/files') ? (githubFiles ?? FILES) : (githubBody ?? PULL);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  llm = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      llmCalls.push(body);
      if (llmStatus !== 200) {
        res.writeHead(llmStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'model unavailable' } }));
        return;
      }
      const messages = (body.messages ?? []) as { role: string; content: string }[];
      const isExtraction = messages.some((m) => m.content.includes('extraction stage'));
      let content: string;
      if (!isExtraction) {
        content = 'Jev blocked this because the migration is irreversible and untested.';
      } else {
        const attempt = llmCalls.filter((c) =>
          (c.messages ?? []).some((m) => m.content.includes('extraction stage')),
        ).length;
        content = extractionResponses.length
          ? (extractionResponses[Math.min(attempt - 1, extractionResponses.length - 1)] ?? '{}')
          : (extractionResponse ?? '{}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  await new Promise<void>((r) => github.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => llm.listen(0, '127.0.0.1', r));
  const g = github.address();
  const l = llm.address();
  if (typeof g === 'string' || g === null || typeof l === 'string' || l === null) {
    throw new Error('no address');
  }
  githubUrl = `http://127.0.0.1:${g.port}`;
  llmUrl = `http://127.0.0.1:${l.port}/v1`;
});

after(async () => {
  await new Promise<void>((r, j) => github.close((e) => (e ? j(e) : r())));
  await new Promise<void>((r, j) => llm.close((e) => (e ? j(e) : r())));
});

beforeEach(() => {
  githubStatus = 200;
  githubHeaders = {};
  githubBody = null;
  githubFiles = null;
  githubCalls = [];
  extractionResponse = null;
  extractionResponses = [];
  llmStatus = 200;
  llmCalls = [];

  process.env.GITHUB_API_URL = githubUrl;
  delete process.env.GITHUB_TOKEN;
  delete process.env.LLM_PROVIDER;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
});

function useLiveModel() {
  process.env.LLM_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'test-key';
  process.env.GROQ_BASE_URL = llmUrl;
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
}

async function review(url = PR_URL) {
  const events: AnalysisEvent[] = [];
  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({ mode: 'pr-risk', input: '', prUrl: url })) {
    events.push(event);
    if (event.type === 'result') result = event.result;
  }
  return { events, result };
}

const stageEvents = (events: AnalysisEvent[]) =>
  events.filter((e) => e.type === 'stage') as Extract<AnalysisEvent, { type: 'stage' }>[];

/* ------------------------------------------------------------ happy path */

test('a live PR review runs fetch → LLM → schema → Jev → action → explanation', async () => {
  useLiveModel();
  extractionResponse = envelope(PR_FACTS);

  const { events, result } = await review();
  assert.ok(result);

  const done = stageEvents(events)
    .filter((e) => e.status === 'done')
    .map((e) => e.stage);
  assert.deepEqual(done, ['fetch', 'analyze', 'facts', 'decide', 'act', 'explain']);

  assert.equal(githubCalls.length, 2, 'the PR and its files are fetched');
  assert.match(githubCalls[0], /^\/repos\/acme\/payments\/pulls\/412$/);
  assert.match(githubCalls[1], /^\/repos\/acme\/payments\/pulls\/412\/files\?per_page=100$/);

  assert.equal(result.pullRequest?.number, 412);
  assert.equal(result.pullRequest?.repo, 'acme/payments');
  assert.equal(result.pullRequest?.author, 'dana');
  assert.equal(result.pullRequest?.baseBranch, 'main');
  assert.equal(result.pullRequest?.headBranch, 'feat/ledger');
  assert.equal(result.pullRequest?.changedFiles, 14);
  assert.equal(result.pullRequest?.additions, 342);
  assert.equal(result.meta.source, 'live');
  assert.ok(typeof result.timings.fetchMs === 'number');
});

test('the PR title, diff and patches are what the model is asked about', async () => {
  useLiveModel();
  extractionResponse = envelope(PR_FACTS);
  await review();

  const prompt = llmCalls[0].messages.map((m) => m.content).join('\n');
  assert.match(prompt, /Refactor payment processing/);
  assert.match(prompt, /14 files changed, \+342 \/ -87/);
  assert.match(prompt, /src\/payments\/charge\.ts/);
  assert.match(prompt, /ALTER TABLE invoices DROP COLUMN totals/);
  assert.match(prompt, /You do NOT make the decision/);
});

test('a pull-request event is emitted before any analysis begins', async () => {
  useLiveModel();
  extractionResponse = envelope(PR_FACTS);
  const { events } = await review();

  const prIndex = events.findIndex((e) => e.type === 'pull-request');
  const analyzeIndex = events.findIndex((e) => e.type === 'stage' && e.stage === 'analyze');
  assert.ok(prIndex >= 0 && prIndex < analyzeIndex);
});

/* ------------------------------------------------- Jev stays authoritative */

test('the model saying "likely safe to merge" does not stop Jev blocking', async () => {
  useLiveModel();
  extractionResponse = envelope(PR_FACTS, 'PROCEED');

  const { result } = await review();
  assert.ok(result);

  assert.equal(result.llm.stance, 'PROCEED');
  assert.equal(result.llm.headline, 'Likely safe to merge');
  assert.equal(result.decision.stance, 'BLOCK');
  assert.equal(result.divergence.agree, false);

  const fired = result.trace.map((r) => r.id);
  for (const expected of ['PR-SEC-002', 'PR-TEST-001', 'PR-TEST-002']) {
    assert.ok(fired.includes(expected), `expected ${expected} to fire, got ${fired.join(', ')}`);
  }
  assert.ok(result.decision.veto, 'an irreversible untested migration is a veto');
});

test('the explanation call is given the decision, the score and the fired rules', async () => {
  useLiveModel();
  extractionResponse = envelope(PR_FACTS);
  const { result } = await review();

  const explain = llmCalls.at(-1);
  const prompt = (explain?.messages ?? []).map((m) => m.content).join('\n');
  assert.match(prompt, /JEV DECISION/);
  assert.match(prompt, /RULES THAT FIRED/);
  assert.match(prompt, /PR-TEST-001/);
  assert.match(prompt, /REQUIRED ACTIONS/);
  assert.match(prompt, /You do not get to change it/);
  assert.match(result?.explanation ?? '', /Jev blocked this/);
});

/* --------------------------------------------------------- schema retry */

test('invalid structured output triggers exactly one corrective retry', async () => {
  useLiveModel();
  extractionResponses = [
    envelope({ ...PR_FACTS, blastRadius: 'enormous', testCoverageSignal: 7 }),
    envelope(PR_FACTS),
  ];

  const { result } = await review();
  assert.ok(result);

  const extractionCalls = llmCalls.filter((c) =>
    c.messages.some((m) => m.content.includes('extraction stage')),
  );
  assert.equal(extractionCalls.length, 2, 'one retry, not a loop');
  assert.match(
    extractionCalls[1].messages.at(-1)?.content ?? '',
    /failed schema validation/,
    'the retry tells the model what was wrong',
  );
  assert.equal(result.extractionAttempts, 2);
  assert.equal(result.validation.repairs.length, 0, 'the clean retry is the one kept');
  assert.equal(result.rawFacts.blastRadius, 'service');
});

test('when the retry is also invalid the defaults hold and the run still decides', async () => {
  useLiveModel();
  extractionResponses = [
    envelope({ ...PR_FACTS, blastRadius: 'enormous' }),
    envelope({ ...PR_FACTS, blastRadius: 'still-wrong' }),
  ];

  const { result } = await review();
  assert.ok(result);
  assert.equal(result.extractionAttempts, 2);
  assert.equal(result.rawFacts.blastRadius, 'unknown', 'rejected, not passed through');
  assert.ok(result.decision, 'a decision is still produced');
});

/* ------------------------------------------------------- failure modes */

test('an invalid URL fails before any network call', async () => {
  const { events, result } = await review('https://gitlab.com/a/b/pull/1');
  assert.equal(result, null, 'no decision without input');
  assert.equal(githubCalls.length, 0);
  assert.ok(
    events.some((e) => e.type === 'stage' && e.stage === 'fetch' && e.status === 'failed'),
  );
  assert.ok(events.some((e) => e.type === 'error' && /Only github\.com/.test(e.message)));
});

test('a missing pull request is reported as not found', async () => {
  githubStatus = 404;
  const { events, result } = await review();
  assert.equal(result, null);
  assert.ok(
    events.some((e) => e.type === 'error' && /No such pull request/.test(e.message)),
  );
});

test('a private repository is explained rather than leaking a raw 403', async () => {
  githubStatus = 403;
  githubHeaders = { 'x-ratelimit-remaining': '57' };
  const { events } = await review();
  assert.ok(
    events.some((e) => e.type === 'error' && /private or access-restricted/.test(e.message)),
  );
});

test('a rate limit says so, and says how to raise it', async () => {
  githubStatus = 403;
  githubHeaders = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' };
  const { events } = await review();
  const error = events.find((e) => e.type === 'error');
  assert.ok(error && error.type === 'error');
  assert.match(error.message, /rate limit reached/i);
  assert.match(error.message, /GITHUB_TOKEN/);
});

test('an unexpected GitHub failure surfaces the status, not a stack trace', async () => {
  githubStatus = 500;
  const { events } = await review();
  assert.ok(events.some((e) => e.type === 'error' && /GitHub returned 500/.test(e.message)));
});

test('a model outage after a successful fetch falls back to mock and still decides', async () => {
  useLiveModel();
  llmStatus = 503;

  const { events, result } = await review();
  assert.ok(result);
  assert.equal(result.pullRequest?.number, 412, 'the fetched PR survives the model failure');
  assert.equal(result.meta.source, 'mock');
  assert.ok(events.some((e) => e.type === 'error' && /extraction failed/.test(e.message)));
  assert.ok(result.decision, 'the pipeline still produces a decision');
});

test('mock mode reviews a real PR payload with no model configured', async () => {
  const { result } = await review();
  assert.ok(result);
  assert.equal(result.meta.source, 'mock');
  assert.equal(result.pullRequest?.title, 'Refactor payment processing');
  assert.equal(result.rawFacts.title, 'Refactor payment processing');
  assert.ok(result.decision.rulesEvaluated > 0);
});

test('GITHUB_TOKEN is sent to GitHub when configured', async () => {
  process.env.GITHUB_TOKEN = 'ghp_secret';
  let seen: string | undefined;
  const probe = createServer((req, res) => {
    seen = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify((req.url ?? '').includes('/files') ? FILES : PULL));
  });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const addr = probe.address();
  if (typeof addr === 'string' || addr === null) throw new Error('no address');
  process.env.GITHUB_API_URL = `http://127.0.0.1:${addr.port}`;

  await review();
  await new Promise<void>((r, j) => probe.close((e) => (e ? j(e) : r())));

  assert.equal(seen, 'Bearer ghp_secret');
});

/* --------------------------------------------------- extraction accuracy */

test('a filename containing "index" is not read as a database schema change', async () => {
  githubBody = { ...PULL, title: 'fix: correct absolute URL detection', changed_files: 3 };
  githubFiles = [
    {
      filename: 'lib/helpers/isAbsoluteURL.js',
      status: 'modified',
      additions: 2,
      deletions: 2,
      changes: 4,
      patch: "@@\n-return /^([a-z][a-z\\d+\\-.]*:)?\\/\\//i.test(url);\n+return /^([a-z][a-z\\d+\\-.]*:)\\/\\//i.test(url);\n",
    },
    {
      filename: 'test/unit/regression/SNYK-JS-AXIOS-7361793.js',
      status: 'added',
      additions: 45,
      deletions: 0,
      changes: 45,
      patch: "@@\n+import axios from '../../../index.js';\n+import assert from 'assert';\n",
    },
  ];

  const { result } = await review();
  assert.ok(result);
  assert.equal(result.rawFacts.hasSchemaChange, false, 'index.js is not a schema change');
  assert.equal(result.rawFacts.hasDatabaseMigration, false);
  assert.ok(
    !result.trace.some((r) => r.id === 'PR-DATA-002'),
    'the rollback-safety rule must not fire on a URL parsing fix',
  );
});
