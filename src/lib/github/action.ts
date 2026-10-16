/**
 * The JevOps GitHub Action (action.yml at the repo root), minus the process
 * plumbing in scripts/action.mts: which pull request to review, how the
 * action's inputs map onto the app's environment, and what the run reports
 * back to the workflow. It is the same pipeline as a Live PR review.
 */
import { runAnalysis } from '../pipeline';
import { STANCE_LABEL, STANCE_RANK, type AnalysisResult, type Stance } from '../types';
import { formatPrComment } from './comment';
import { parsePullRequestUrl, refToUrl } from './url';

type Env = Record<string, string | undefined>;

/** `fail-on`: the least severe stance that fails the check. */
export const FAIL_ON: Record<string, Stance | null> = {
  never: null,
  guardrails: 'PROCEED_WITH_GUARDRAILS',
  hold: 'HOLD',
  block: 'BLOCK',
};

export type Resolved<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * The pull request to review, as "owner/repo#123": the `pull-request` input
 * when given, otherwise the pull request that triggered the workflow.
 */
export function resolvePullRequest(env: Env, readEvent: () => unknown): Resolved<string> {
  const explicit = env.JEVOPS_INPUT_PULL_REQUEST?.trim();
  if (explicit) {
    const parsed = parsePullRequestUrl(explicit);
    if (!parsed.ok) return { ok: false, reason: `pull-request: ${parsed.reason}` };
    const { owner, repo, number } = parsed.ref;
    return { ok: true, value: `${owner}/${repo}#${number}` };
  }

  const event = env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'pull_request_target') {
    return {
      ok: false,
      reason: `JevOps reviews pull requests, but this run was triggered by "${event ?? 'unknown'}". Run it on pull_request, or pass the pull-request input.`,
    };
  }
  const payload = readEvent() as { pull_request?: { number?: unknown }; repository?: { full_name?: unknown } };
  const number = payload?.pull_request?.number;
  const repo = payload?.repository?.full_name ?? env.GITHUB_REPOSITORY;
  if (typeof number !== 'number' || typeof repo !== 'string') {
    return { ok: false, reason: 'The event payload has no pull request number.' };
  }
  return { ok: true, value: `${repo}#${number}` };
}

/**
 * Map the action's inputs onto the variables the app already reads. Inputs
 * arrive as JEVOPS_INPUT_*; an empty one leaves any value set on the step's
 * `env:` alone. Comments are only ever posted on the repository the workflow
 * runs in, whatever pull request it was pointed at.
 */
export function applyActionInputs(env: Env): void {
  const copy: [string, string][] = [
    ['JEVOPS_INPUT_GITHUB_TOKEN', 'GITHUB_TOKEN'],
    ['JEVOPS_INPUT_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
    ['JEVOPS_INPUT_GROQ_API_KEY', 'GROQ_API_KEY'],
  ];
  for (const [from, to] of copy) {
    const value = env[from]?.trim();
    if (value) env[to] = value;
  }

  if (env.JEVOPS_INPUT_COMMENT?.trim().toLowerCase() === 'false') {
    delete env.JEVOPS_POST_PR_COMMENTS;
    delete env.JEVOPS_COMMENT_REPOS;
  } else {
    env.JEVOPS_POST_PR_COMMENTS = '1';
    env.JEVOPS_COMMENT_REPOS = env.GITHUB_REPOSITORY ?? '';
  }
}

export interface ActionMessage {
  level: 'error' | 'warning' | 'notice';
  text: string;
}

export interface ActionReport {
  /** Non-zero fails the check: a run that could not decide, or `fail-on` was reached. */
  exitCode: 0 | 1;
  outputs: Record<string, string>;
  /** Markdown for the job summary. Empty when the run never reached a decision. */
  summary: string;
  messages: ActionMessage[];
}

/** Review one pull request and report the decision in the shape a workflow uses. */
export async function runAction(pullRequest: string, failOn: string, signal?: AbortSignal): Promise<ActionReport> {
  const messages: ActionMessage[] = [];
  const fail = (text: string): ActionReport => ({
    exitCode: 1,
    outputs: {},
    summary: '',
    messages: [...messages, { level: 'error', text }],
  });

  const key = failOn.trim().toLowerCase() || 'never';
  if (!Object.hasOwn(FAIL_ON, key)) {
    return fail(`fail-on must be one of ${Object.keys(FAIL_ON).join(', ')} (got "${failOn}").`);
  }
  const threshold = FAIL_ON[key];

  let result: AnalysisResult | null = null;
  for await (const event of runAnalysis({ mode: 'pr-risk', input: '', prUrl: pullRequest, signal })) {
    if (event.type === 'error') return fail(event.message);
    if (event.type === 'result') result = event.result;
  }
  if (!result?.pullRequest) return fail('The review ended without a decision.');

  const { decision, trace, divergence, meta } = result;
  const comment = result.actions.find((a) => a.id === 'pr-comment');
  const commentUrl = typeof comment?.payload?.url === 'string' ? comment.payload.url : '';

  if (meta.source === 'mock') {
    messages.push({
      level: 'notice',
      text: 'No model key was given, so the deterministic mock extracted the facts. It only matches keywords; pass openrouter-api-key or groq-api-key for a real read of the change.',
    });
  }
  if (comment?.status === 'failed') {
    messages.push({ level: 'warning', text: `The decision was not posted: ${comment.detail}` });
  }

  const reached = threshold !== null && STANCE_RANK[decision.stance] >= STANCE_RANK[threshold];
  if (reached) {
    messages.push({
      level: 'error',
      text: `JevOps returned ${STANCE_LABEL[decision.stance]} (${decision.scoreLabel} ${decision.score}/100), which fails this check (fail-on: ${key}).`,
    });
  }

  const ref = parsePullRequestUrl(pullRequest);
  const link = ref.ok ? `[${pullRequest}](${refToUrl(ref.ref)})` : pullRequest;
  const posted =
    comment?.status === 'executed' && commentUrl
      ? `[posted on the pull request](${commentUrl})`
      : !process.env.JEVOPS_POST_PR_COMMENTS
        ? 'not posted (comment: false)'
        : `not posted: ${comment?.detail ?? 'no comment action ran'}`;
  const summary = [
    `Reviewed ${link}. Decision ${posted}.`,
    '',
    formatPrComment({ pullRequest: result.pullRequest, decision, trace, divergence, meta }),
  ].join('\n');

  return {
    exitCode: reached ? 1 : 0,
    outputs: {
      stance: decision.stance,
      score: String(decision.score),
      severity: decision.severityLabel,
      headline: decision.headline,
      source: meta.source,
      'model-agreed': String(divergence.agree),
      'comment-url': commentUrl,
    },
    summary,
    messages,
  };
}
