import type { FiredRule } from '../jev/engine';
import { STANCE_LABEL, type AnalysisMeta, type Divergence, type JevDecision, type PullRequestSummary } from '../types';
import { JEVOPS_COMMENT_MARKER } from './client';

const REPO_URL = 'https://github.com/nishant-ranjan28/jevops';

/* ------------------------------------------------------------- opt-in */

export type PrCommentSetting = { enabled: true } | { enabled: false; reason: string };

/**
 * Whether this deployment may comment on `repo` ("owner/name"). All three
 * must hold, so a public demo can never post and a self-hosted instance only
 * posts where its owner said so:
 *   - JEVOPS_POST_PR_COMMENTS=1
 *   - GITHUB_TOKEN is set (it needs "Pull requests: write" on the repo)
 *   - the repo matches JEVOPS_COMMENT_REPOS (comma-separated; "owner/*" allowed)
 * Without the allowlist, anyone who can reach the app could make it comment on
 * any public pull request with the owner's token.
 */
export function prCommentSetting(
  repo: string,
  env: Record<string, string | undefined> = process.env,
): PrCommentSetting {
  if (env.JEVOPS_POST_PR_COMMENTS?.trim() !== '1') {
    return { enabled: false, reason: 'Off on this deployment (opt in with JEVOPS_POST_PR_COMMENTS=1)' };
  }
  if (!env.GITHUB_TOKEN?.trim()) {
    return { enabled: false, reason: 'JEVOPS_POST_PR_COMMENTS is on, but GITHUB_TOKEN is not set' };
  }
  const allowed = (env.JEVOPS_COMMENT_REPOS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const target = repo.toLowerCase();
  const owner = target.split('/')[0];
  if (!allowed.some((a) => a === target || a === `${owner}/*`)) {
    return { enabled: false, reason: `${repo} is not in JEVOPS_COMMENT_REPOS` };
  }
  return { enabled: true };
}

/* ---------------------------------------------------------- formatting */

export interface PrCommentInput {
  pullRequest: Pick<PullRequestSummary, 'repo' | 'number'>;
  decision: JevDecision;
  trace: FiredRule<string>[];
  divergence: Divergence;
  meta: Pick<AnalysisMeta, 'source' | 'servedBy' | 'model'>;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * The comment JevOps posts on a pull request. Pure and deterministic: the same
 * decision always renders the same text (no timestamps, no model prose), and
 * it says plainly that the policy decided, not the model.
 */
export function formatPrComment({ decision, trace, divergence, meta }: PrCommentInput): string {
  const lines: string[] = [JEVOPS_COMMENT_MARKER];

  lines.push(
    `### JevOps: ${decision.headline}`,
    '',
    `**${decision.scoreLabel} ${decision.score}/100** · ${decision.severityLabel} · policy \`${decision.policyId}\` v${decision.policyVersion}`,
    '',
    'This decision was computed by the policy from the extracted facts, not by the model. The same facts always produce the same decision.',
  );

  if (decision.veto) {
    lines.push(
      '',
      `> **Hard veto: \`${decision.veto.ruleId}\`** · ${decision.veto.label} (${decision.veto.threshold}). A veto decides the outcome on its own.`,
    );
  }

  lines.push(
    '',
    divergence.agree
      ? `The model's recommendation (${STANCE_LABEL[divergence.llmStance]}) matches the policy.`
      : `**The model disagreed.** It recommended ${STANCE_LABEL[divergence.llmStance]}; the policy returned ${STANCE_LABEL[divergence.jevStance]} (${divergence.delta > 0 ? 'stricter' : 'looser'}, Δ${signed(divergence.delta)}). The policy is authoritative.`,
  );

  if (decision.fields.length) {
    lines.push('', '| | |', '|---|---|', ...decision.fields.map((f) => `| ${cell(f.label)} | ${cell(f.value)} |`));
  }

  if (decision.requiredActions.length) {
    lines.push('', '**Required of the team**', ...decision.requiredActions.map((a) => `- ${a}`));
  }

  lines.push(
    '',
    `<details><summary>Rules that fired (${trace.length} of ${decision.rulesEvaluated})</summary>`,
    '',
  );
  if (trace.length) {
    lines.push(
      '| Rule | Weight | Condition |',
      '|---|---:|---|',
      ...trace.map((r) => `| \`${r.id}\` | ${signed(r.weight)} | ${cell(r.label)} |`),
    );
  } else {
    lines.push('No rules fired.');
  }
  lines.push('', '</details>');

  const extractedBy = meta.source === 'live' ? `${meta.servedBy} · ${meta.model}` : 'the deterministic mock';
  lines.push(
    '',
    '---',
    `<sub>Facts extracted by ${extractedBy}; decision by Jev. This comment is updated in place on re-runs. [JevOps](${REPO_URL})</sub>`,
  );

  return `${lines.join('\n')}\n`;
}
