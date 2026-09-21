/**
 * Integration test against a REAL public GitHub pull request.
 *
 *   https://github.com/axios/axios/pull/6539
 *   "fix(sec): disregard protocol-relative URL to remediate SSRF"
 *
 * Chosen because it is a genuine, merged, security-relevant code change with
 * regression tests — not a filler PR — and because merged pull requests are
 * immutable, so its file list and line counts never change.
 *
 * No API key is needed: the run uses the deterministic mock model, so this
 * exercises the GitHub half for real while staying reproducible. Skips itself
 * if GitHub is unreachable rather than failing a build offline.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { fetchPullRequest } from '../src/lib/github/client';
import { parsePullRequestUrl } from '../src/lib/github/url';
import { runAnalysis } from '../src/lib/pipeline';
import type { AnalysisResult } from '../src/lib/types';

const PR_URL = 'https://github.com/axios/axios/pull/6539';
const TIMEOUT = 25_000;
/** Six REST calls across the three tests, with headroom. */
const NEEDED_CALLS = 8;

let reachable = false;
let skipReason = '';

before(async () => {
  delete process.env.GITHUB_API_URL;
  try {
    const token = process.env.GITHUB_TOKEN?.trim();
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        'User-Agent': 'JevOps-Decision-Cockpit',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403 || response.status === 429) {
      skipReason = 'GitHub rate limit reached for this IP';
    } else if (!response.ok) {
      skipReason = `GitHub returned ${response.status}`;
    } else {
      // /rate_limit answers 200 even when the quota is spent, so read the
      // remaining count rather than the status. These tests need ~6 calls.
      const body = (await response.json()) as {
        resources?: { core?: { remaining?: number; reset?: number } };
      };
      const remaining = body.resources?.core?.remaining ?? 0;
      if (remaining < NEEDED_CALLS) {
        const reset = body.resources?.core?.reset;
        const when = reset ? new Date(reset * 1000).toISOString().slice(11, 16) : 'unknown';
        skipReason = `GitHub quota exhausted (${remaining} left, resets ${when} UTC) — set GITHUB_TOKEN to raise it`;
      } else {
        reachable = true;
      }
    }
  } catch (error) {
    skipReason = `GitHub unreachable: ${(error as Error).message}`;
  }
});

beforeEach(() => {
  delete process.env.GITHUB_API_URL;
  delete process.env.LLM_PROVIDER;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

async function review(): Promise<AnalysisResult> {
  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({ mode: 'pr-risk', input: '', prUrl: PR_URL })) {
    if (event.type === 'error') throw new Error(`pipeline error: ${event.message}`);
    if (event.type === 'result') result = event.result;
  }
  if (!result) throw new Error('no result produced');
  return result;
}

test('fetches the real axios SSRF pull request', { timeout: TIMEOUT }, async (t) => {
  if (!reachable) return t.skip(skipReason);

  const parsed = parsePullRequestUrl(PR_URL);
  assert.ok(parsed.ok);

  const pr = await fetchPullRequest(parsed.ref);

  assert.equal(pr.number, 6539);
  assert.equal(pr.title, 'fix(sec): disregard protocol-relative URL to remediate SSRF');
  assert.equal(pr.merged, true);
  assert.equal(pr.baseBranch, 'v1.x');
  assert.equal(pr.changedFiles, 3);
  assert.equal(pr.additions, 49);
  assert.equal(pr.deletions, 4);

  const names = pr.files.map((f) => f.filename);
  assert.deepEqual(names.sort(), [
    'lib/helpers/isAbsoluteURL.js',
    'test/specs/helpers/isAbsoluteURL.spec.js',
    'test/unit/regression/SNYK-JS-AXIOS-7361793.js',
  ]);
  assert.ok(
    pr.files.every((f) => typeof f.patch === 'string' && f.patch.length > 0),
    'every file came back with a patch',
  );
});

test('runs the full pipeline over the real PR', { timeout: TIMEOUT }, async (t) => {
  if (!reachable) return t.skip(skipReason);

  const result = await review();

  assert.equal(result.pullRequest?.number, 6539);
  assert.equal(result.pullRequest?.repo, 'axios/axios');
  assert.equal(result.pullRequest?.changedFiles, 3);
  assert.equal(result.pullRequest?.state, 'merged');

  // The schema gate accepted everything the extractor produced.
  assert.equal(result.validation.shapeRejected, false);
  assert.equal(result.validation.repairs.length, 0);
  assert.equal(result.validation.fieldsAccepted, result.validation.fieldsTotal);

  // Jev produced a real, typed decision from those facts.
  assert.ok(result.decision.rulesEvaluated > 0);
  assert.ok(['SHIP', 'SHIP_BEHIND_FLAG', 'STAGED_ROLLOUT', 'HOLD', 'BLOCK'].includes(
    result.decision.headline.replaceAll(' ', '_'),
  ));
  assert.equal(result.decision.policyId, 'jev.pr-risk');
  assert.ok(result.explanation.length > 0);

  // This PR adds regression tests, which the extractor should see.
  assert.equal(result.rawFacts.hasTests, true);

  // Every fired rule is traceable.
  for (const rule of result.trace) {
    assert.match(rule.id, /^PR-[A-Z]+-\d{3}$/);
    assert.ok(rule.label.length > 0);
  }
});

test('the same real PR always yields the same decision', { timeout: TIMEOUT }, async (t) => {
  if (!reachable) return t.skip(skipReason);

  const first = await review();
  const second = await review();

  assert.equal(first.decision.score, second.decision.score);
  assert.equal(first.decision.headline, second.decision.headline);
  assert.equal(first.decision.stance, second.decision.stance);
  assert.deepEqual(
    first.trace.map((r) => r.id),
    second.trace.map((r) => r.id),
  );
  assert.deepEqual(first.rawFacts, second.rawFacts);
});
