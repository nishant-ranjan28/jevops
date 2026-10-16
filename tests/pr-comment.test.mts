/**
 * The opt-in PR comment: formatting, the opt-in gate, and the write path.
 *
 * A local server stands in for GitHub and records every request, so "nothing
 * was written" is asserted directly. The model is the deterministic mock.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { JEVOPS_COMMENT_MARKER } from '../src/lib/github/client';
import { formatPrComment, prCommentSetting } from '../src/lib/github/comment';
import { runAnalysis } from '../src/lib/pipeline';
import type { AnalysisEvent, AnalysisResult, Divergence, JevDecision } from '../src/lib/types';

interface Call {
  method: string;
  path: string;
  authorization?: string;
  body?: { body?: string };
}

let github: Server;
let calls: Call[] = [];
let comments: { id: number; body: string; html_url: string }[] = [];
let postStatus = 201;
let patchStatus = 200;

const PR_URL = 'https://github.com/acme/payments/pull/412';
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
  changed_files: 2,
  additions: 40,
  deletions: 12,
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
      calls.push({ method, path, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (method === 'GET' && path.endsWith('/pulls/412')) return send(200, PULL);
      if (method === 'GET' && path.includes('/pulls/412/files')) return send(200, FILES);
      if (method === 'GET' && path.includes('/issues/412/comments')) return send(200, comments);
      if (method === 'POST' && path.endsWith('/issues/412/comments')) {
        if (postStatus !== 201) return send(postStatus, { message: 'Resource not accessible by integration' });
        const created = { id: 900 + comments.length, body: JSON.parse(raw).body, html_url: `${PR_URL}#issuecomment-${900 + comments.length}` };
        comments.push(created);
        return send(201, created);
      }
      const patch = path.match(/\/issues\/comments\/(\d+)$/);
      if (method === 'PATCH' && patch) {
        if (patchStatus !== 200) return send(patchStatus, { message: 'Forbidden' });
        const target = comments.find((c) => c.id === Number(patch[1]));
        if (!target) return send(404, { message: 'Not Found' });
        target.body = JSON.parse(raw).body;
        return send(200, target);
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
  comments = [];
  postStatus = 201;
  patchStatus = 200;
  for (const name of [
    'JEVOPS_POST_PR_COMMENTS',
    'JEVOPS_COMMENT_REPOS',
    'GITHUB_TOKEN',
    'LLM_PROVIDER',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'OLLAMA_MODEL',
  ]) {
    delete process.env[name];
  }
});

function optIn() {
  process.env.JEVOPS_POST_PR_COMMENTS = '1';
  process.env.GITHUB_TOKEN = 'test-write-token';
  process.env.JEVOPS_COMMENT_REPOS = 'acme/payments';
}

async function review(prUrl: string | null = PR_URL) {
  const events: AnalysisEvent[] = [];
  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({ mode: 'pr-risk', input: prUrl ? '' : PULL.body, prUrl: prUrl ?? undefined })) {
    events.push(event);
    if (event.type === 'result') result = event.result;
  }
  assert.ok(result, 'the run always completes');
  const action = result.actions.find((a) => a.id === 'pr-comment');
  return { events, result, action };
}

const writes = () => calls.filter((c) => c.method !== 'GET');

/* ------------------------------------------------------------- formatting */

const decision: JevDecision = {
  stance: 'BLOCK',
  headline: 'BLOCK',
  score: 88,
  scoreLabel: 'Risk score',
  severityLabel: 'CRITICAL',
  fields: [
    { label: 'Release', value: 'BLOCK', tone: 'bad' },
    { label: 'Reviewers', value: '2 | one from security', tone: 'warn' },
  ],
  requiredActions: ['Add a reversible migration path'],
  veto: { ruleId: 'PR-DATA-002', label: 'Irreversible migration shipping without test coverage', threshold: 'rollback-unsafe + migration + no-tests' },
  policyId: 'jev.pr-risk',
  policyVersion: '1.2.0',
  rulesEvaluated: 24,
};
const trace = [
  { id: 'PR-DATA-002', label: 'Irreversible migration shipping without test coverage', category: 'reliability' as never, weight: 40, flags: [] },
  { id: 'PR-TEST-001', label: 'No tests included', category: 'quality' as never, weight: 12, flags: [] },
];
const divergence: Divergence = { agree: false, delta: 3, llmStance: 'PROCEED', jevStance: 'BLOCK', drivers: trace, summary: '' };
const input = {
  pullRequest: { repo: 'acme/payments', number: 412 },
  decision,
  trace,
  divergence,
  meta: { source: 'live' as const, servedBy: 'ollama', model: 'llama3.1' },
};

test('the comment is deterministic and says the policy decided, not the model', () => {
  const body = formatPrComment(input);
  assert.equal(body, formatPrComment(input), 'same input, same text');
  assert.ok(body.startsWith(JEVOPS_COMMENT_MARKER), 'the marker lets a re-run find and edit it');
  assert.match(body, /### JevOps: BLOCK/);
  assert.match(body, /computed by the policy from the extracted facts, not by the model/);
  assert.match(body, /Hard veto: `PR-DATA-002`/);
  assert.match(body, /The model disagreed\.\*\* It recommended PROCEED; the policy returned BLOCK \(stricter, Δ\+3\)/);
  assert.match(body, /Rules that fired \(2 of 24\)/);
  assert.match(body, /\| `PR-TEST-001` \| \+12 \| No tests included \|/);
  assert.match(body, /\| Reviewers \| 2 \\\| one from security \|/, 'pipes inside cells are escaped');
  assert.match(body, /Facts extracted by ollama · llama3\.1/);
  assert.doesNotMatch(body, /\d{4}-\d{2}-\d{2}T/, 'no timestamps');
});

test('a backslash before a pipe cannot break out of a table cell', () => {
  const body = formatPrComment({
    ...input,
    decision: { ...decision, fields: [{ label: 'Path', value: 'C:\\temp\\|x', tone: 'neutral' }] },
  });
  assert.ok(body.includes('| Path | C:\\\\temp\\\\\\|x |'), 'backslashes and the pipe are both escaped');
});

test('an agreeing model is reported as matching', () => {
  const body = formatPrComment({ ...input, divergence: { ...divergence, agree: true, delta: 0, llmStance: 'BLOCK' } });
  assert.match(body, /The model's recommendation \(BLOCK\) matches the policy\./);
});

/* ---------------------------------------------------------------- opt-in */

test('posting is off unless the flag, a token and the allowlist all agree', () => {
  assert.equal(prCommentSetting('acme/payments', {}).enabled, false);
  assert.equal(prCommentSetting('acme/payments', { JEVOPS_POST_PR_COMMENTS: '1' }).enabled, false);
  assert.equal(
    prCommentSetting('acme/payments', { JEVOPS_POST_PR_COMMENTS: '1', GITHUB_TOKEN: 't' }).enabled,
    false,
    'no allowlist means no repo',
  );
  const on = { JEVOPS_POST_PR_COMMENTS: '1', GITHUB_TOKEN: 't' };
  assert.equal(prCommentSetting('acme/payments', { ...on, JEVOPS_COMMENT_REPOS: 'acme/payments' }).enabled, true);
  assert.equal(prCommentSetting('ACME/Payments', { ...on, JEVOPS_COMMENT_REPOS: 'acme/payments' }).enabled, true);
  assert.equal(prCommentSetting('acme/web', { ...on, JEVOPS_COMMENT_REPOS: 'other/x, acme/*' }).enabled, true);
  assert.equal(prCommentSetting('evil/payments', { ...on, JEVOPS_COMMENT_REPOS: 'acme/*' }).enabled, false);
});

/* ------------------------------------------------------------ write path */

test('off by default: the action is skipped and nothing is written', async () => {
  const { action, result } = await review();
  assert.equal(action?.status, 'skipped');
  assert.match(action?.detail ?? '', /JEVOPS_POST_PR_COMMENTS=1/);
  assert.equal(writes().length, 0);
  assert.ok(result.decision);
});

test('a token without the allowlist still writes nothing', async () => {
  process.env.JEVOPS_POST_PR_COMMENTS = '1';
  process.env.GITHUB_TOKEN = 'test-write-token';
  const { action } = await review();
  assert.equal(action?.status, 'skipped');
  assert.match(action?.detail ?? '', /not in JEVOPS_COMMENT_REPOS/);
  assert.equal(writes().length, 0);
});

test('opted in: the decision is posted as one comment with the token', async () => {
  optIn();
  const { action, result } = await review();
  assert.equal(action?.status, 'executed');
  assert.equal(action?.detail, 'Commented on acme/payments#412');
  assert.equal(action?.payload?.url, `${PR_URL}#issuecomment-900`);
  const [post] = writes();
  assert.equal(post.method, 'POST');
  assert.equal(post.path, '/repos/acme/payments/issues/412/comments');
  assert.equal(post.authorization, 'Bearer test-write-token');
  assert.ok(post.body?.body?.startsWith(JEVOPS_COMMENT_MARKER));
  assert.match(post.body?.body ?? '', new RegExp(`### JevOps: ${result.decision.headline}`));
});

test('a re-run edits the existing JevOps comment instead of adding another', async () => {
  optIn();
  comments.push({ id: 41, body: 'LGTM', html_url: `${PR_URL}#issuecomment-41` });
  comments.push({ id: 77, body: `${JEVOPS_COMMENT_MARKER}\nold decision`, html_url: `${PR_URL}#issuecomment-77` });
  const { action } = await review();
  assert.equal(action?.status, 'executed');
  assert.equal(action?.detail, 'Updated the JevOps comment on acme/payments#412');
  assert.deepEqual(writes().map((c) => `${c.method} ${c.path}`), ['PATCH /repos/acme/payments/issues/comments/77']);
  assert.equal(comments.length, 2, 'no new comment');
  assert.doesNotMatch(comments[1].body, /old decision/);
});

test('a marked comment that cannot be edited falls back to a new comment', async () => {
  optIn();
  patchStatus = 403;
  comments.push({ id: 77, body: `${JEVOPS_COMMENT_MARKER}\nsomeone else`, html_url: '' });
  const { action } = await review();
  assert.equal(action?.status, 'executed');
  assert.deepEqual(writes().map((c) => c.method), ['PATCH', 'POST']);
});

test('a token without write access fails the action, not the run', async () => {
  optIn();
  postStatus = 403;
  const { action, events, result } = await review();
  assert.equal(action?.status, 'failed');
  assert.match(action?.detail ?? '', /may not comment on acme\/payments.*Pull requests: write/);
  const actDone = events.find((e) => e.type === 'stage' && e.stage === 'act' && e.status === 'done');
  assert.ok(actDone && actDone.type === 'stage');
  assert.match(actDone.detail ?? '', /1 failed/);
  assert.ok(result.decision, 'the decision still lands');
  assert.ok(result.explanation, 'and the explanation still runs');
});

test('pasted input never comments, even when opted in', async () => {
  optIn();
  const { action } = await review(null);
  assert.equal(action, undefined);
  assert.equal(calls.length, 0);
});
