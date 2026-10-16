/**
 * The GitHub Action: which pull request it reviews, how its inputs map onto
 * the app's environment, and what it reports back to the workflow.
 *
 * A local server stands in for GitHub and records every request. The model is
 * the deterministic mock.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { applyActionInputs, FAIL_ON, resolvePullRequest, runAction } from '../src/lib/github/action';
import { JEVOPS_COMMENT_MARKER } from '../src/lib/github/client';
import { STANCE_RANK, type Stance } from '../src/lib/types';

let github: Server;
let calls: { method: string; path: string; authorization?: string }[] = [];
let postStatus = 201;

const PULL = {
  number: 412,
  title: 'Drop the legacy invoice_totals column',
  body: 'Migration drops invoice_totals. No tests yet.',
  state: 'open',
  draft: false,
  merged: false,
  user: { login: 'dana' },
  base: { ref: 'main' },
  head: { ref: 'feat/ledger' },
  changed_files: 1,
  additions: 40,
  deletions: 0,
};
const FILES = [
  { filename: 'migrations/2026_drop_totals.sql', status: 'added', additions: 40, deletions: 0, changes: 40, patch: '+ALTER TABLE invoices DROP COLUMN totals;' },
];

before(async () => {
  github = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const path = req.url ?? '';
      const method = req.method ?? 'GET';
      calls.push({ method, path, authorization: req.headers.authorization });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (method === 'GET' && path.endsWith('/acme/payments/pulls/412')) return send(200, PULL);
      if (method === 'GET' && path.includes('/acme/payments/pulls/412/files')) return send(200, FILES);
      if (method === 'GET' && path.includes('/issues/412/comments')) return send(200, []);
      if (method === 'POST' && path.endsWith('/acme/payments/issues/412/comments')) {
        if (postStatus !== 201) return send(postStatus, { message: 'Resource not accessible by integration' });
        return send(201, { id: 900, body: JSON.parse(raw).body, html_url: 'https://github.com/acme/payments/pull/412#issuecomment-900' });
      }
      send(404, { message: 'Not Found' });
    });
  });
  await new Promise<void>((resolve) => github.listen(0, '127.0.0.1', resolve));
  const address = github.address();
  if (typeof address === 'string' || address === null) throw new Error('no server address');
  process.env.GITHUB_API_URL = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  delete process.env.GITHUB_API_URL;
  await new Promise<void>((resolve, reject) => github.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => {
  calls = [];
  postStatus = 201;
  for (const name of [
    'JEVOPS_POST_PR_COMMENTS',
    'JEVOPS_COMMENT_REPOS',
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'LLM_PROVIDER',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'OLLAMA_MODEL',
  ]) {
    delete process.env[name];
  }
});

/** The environment a pull_request run in acme/payments starts with. */
function inActions(inputs: Record<string, string> = {}) {
  process.env.GITHUB_REPOSITORY = 'acme/payments';
  for (const [name, value] of Object.entries({ JEVOPS_INPUT_GITHUB_TOKEN: 'ghs_test', ...inputs })) {
    process.env[name] = value;
  }
  applyActionInputs(process.env);
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('JEVOPS_INPUT_')) delete process.env[name];
  }
}

const writes = () => calls.filter((c) => c.method !== 'GET');

/* ------------------------------------------------------- which pull request */

test('the pull request comes from the triggering event', () => {
  const event = { pull_request: { number: 412 }, repository: { full_name: 'acme/payments' } };
  assert.deepEqual(resolvePullRequest({ GITHUB_EVENT_NAME: 'pull_request' }, () => event), { ok: true, value: 'acme/payments#412' });
  assert.deepEqual(resolvePullRequest({ GITHUB_EVENT_NAME: 'pull_request_target' }, () => event), { ok: true, value: 'acme/payments#412' });
});

test('the pull-request input wins, and is validated', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', JEVOPS_INPUT_PULL_REQUEST: 'https://github.com/acme/web/pull/7' };
  assert.deepEqual(resolvePullRequest(env, () => ({})), { ok: true, value: 'acme/web#7' });
  const bad = resolvePullRequest({ JEVOPS_INPUT_PULL_REQUEST: 'https://gitlab.com/a/b/pull/1' }, () => ({}));
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.reason, /^pull-request: Only github\.com/);
});

test('a run that is not about a pull request says how to point it at one', () => {
  const push = resolvePullRequest({ GITHUB_EVENT_NAME: 'push' }, () => ({}));
  assert.match(push.ok ? '' : push.reason, /triggered by "push".*pull-request input/);
  const empty = resolvePullRequest({ GITHUB_EVENT_NAME: 'pull_request' }, () => ({}));
  assert.equal(empty.ok, false);
});

/* ----------------------------------------------------------------- inputs */

test('inputs map onto the app variables; an empty input keeps the step env', () => {
  const env: Record<string, string | undefined> = {
    GITHUB_REPOSITORY: 'acme/payments',
    GROQ_API_KEY: 'from-step-env',
    JEVOPS_INPUT_GITHUB_TOKEN: 'ghs_test',
    JEVOPS_INPUT_OPENROUTER_API_KEY: 'or-key',
    JEVOPS_INPUT_GROQ_API_KEY: '',
  };
  applyActionInputs(env);
  assert.equal(env.GITHUB_TOKEN, 'ghs_test');
  assert.equal(env.OPENROUTER_API_KEY, 'or-key');
  assert.equal(env.GROQ_API_KEY, 'from-step-env');
  assert.equal(env.JEVOPS_POST_PR_COMMENTS, '1', 'commenting is on by default');
  assert.equal(env.JEVOPS_COMMENT_REPOS, 'acme/payments', 'and only for the repository the workflow runs in');
});

test('comment: false turns posting off, whatever the step env says', () => {
  const env: Record<string, string | undefined> = {
    JEVOPS_POST_PR_COMMENTS: '1',
    JEVOPS_COMMENT_REPOS: 'acme/*',
    JEVOPS_INPUT_COMMENT: 'false',
  };
  applyActionInputs(env);
  assert.equal(env.JEVOPS_POST_PR_COMMENTS, undefined);
  assert.equal(env.JEVOPS_COMMENT_REPOS, undefined);
});

test('with comment: false the summary says so and nothing is written', async () => {
  inActions({ JEVOPS_INPUT_COMMENT: 'false' });
  const report = await runAction('acme/payments#412', 'never');
  assert.equal(report.exitCode, 0);
  assert.match(report.summary, /Decision not posted \(comment: false\)\./);
  assert.equal(writes().length, 0);
});

/* ----------------------------------------------------------------- a run */

test('a run posts the decision and reports it as outputs and a summary', async () => {
  inActions();
  const report = await runAction('acme/payments#412', 'never');
  assert.equal(report.exitCode, 0);
  assert.ok((Object.keys(STANCE_RANK) as string[]).includes(report.outputs.stance));
  assert.match(report.outputs.score, /^\d+$/);
  assert.equal(report.outputs.source, 'mock');
  assert.equal(report.outputs['comment-url'], 'https://github.com/acme/payments/pull/412#issuecomment-900');
  assert.deepEqual(writes().map((c) => `${c.method} ${c.path}`), ['POST /repos/acme/payments/issues/412/comments']);
  assert.equal(writes()[0].authorization, 'Bearer ghs_test');
  assert.match(report.summary, /Reviewed \[acme\/payments#412\]\(https:\/\/github\.com\/acme\/payments\/pull\/412\)\. Decision \[posted/);
  assert.ok(report.summary.includes(JEVOPS_COMMENT_MARKER), 'the summary is the same text as the comment');
  assert.ok(
    report.messages.some((m) => m.level === 'notice' && /deterministic mock/.test(m.text)),
    'a run without a model key says so',
  );
});

test('fail-on fails the check exactly at its stance or worse', async () => {
  inActions({ JEVOPS_INPUT_COMMENT: 'false' });
  const stance = (await runAction('acme/payments#412', 'never')).outputs.stance as Stance;
  for (const [key, threshold] of Object.entries(FAIL_ON)) {
    const report = await runAction('acme/payments#412', key);
    const expected = threshold !== null && STANCE_RANK[stance] >= STANCE_RANK[threshold] ? 1 : 0;
    assert.equal(report.exitCode, expected, `fail-on: ${key} with ${stance}`);
    assert.equal(report.messages.some((m) => m.level === 'error'), expected === 1);
  }
});

test('an unknown fail-on is rejected before anything is fetched', async () => {
  inActions();
  const report = await runAction('acme/payments#412', 'sometimes');
  assert.equal(report.exitCode, 1);
  assert.match(report.messages[0].text, /fail-on must be one of never, guardrails, hold, block/);
  assert.equal(calls.length, 0);
});

test('a refused comment is a warning, not a failed check', async () => {
  inActions();
  postStatus = 403;
  const report = await runAction('acme/payments#412', 'never');
  assert.equal(report.exitCode, 0);
  assert.equal(report.outputs['comment-url'], '');
  assert.ok(report.messages.some((m) => m.level === 'warning' && /not posted: GITHUB_TOKEN may not comment/.test(m.text)));
  assert.match(report.summary, /Decision not posted: GITHUB_TOKEN may not comment/);
});

test('a pull request in another repository is reviewed but never commented on', async () => {
  inActions();
  process.env.JEVOPS_COMMENT_REPOS = 'acme/web';
  const report = await runAction('acme/payments#412', 'never');
  assert.equal(report.exitCode, 0);
  assert.equal(writes().length, 0);
  assert.match(report.summary, /not posted: acme\/payments is not in JEVOPS_COMMENT_REPOS/);
});

test('a pull request that cannot be fetched fails the check', async () => {
  inActions();
  const report = await runAction('acme/payments#9', 'never');
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary, '');
  assert.equal(report.messages.at(-1)?.level, 'error');
  assert.equal(writes().length, 0);
});
