import type { PullRequestContext } from './client';
import type { PullRequestSummary } from '../types';

/**
 * Turn a fetched pull request into the text the extraction model reads.
 *
 * The model needs signal, not the whole diff: a truncated, budgeted view that
 * still contains the things the PR-risk policy cares about — which files moved,
 * how much, and what the patches actually touch.
 */

const MAX_BODY_CHARS = 2_500;
const MAX_TOTAL_PATCH_CHARS = 12_000;
const MAX_PATCH_CHARS_PER_FILE = 2_000;
const MAX_LISTED_FILES = 60;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} characters]`;
}

export function buildPullRequestPrompt(pr: PullRequestContext): string {
  const lines: string[] = [];

  // Title first: it is the strongest single signal, and keyword-based
  // extraction (mock mode) reads the first line as the change title.
  lines.push(pr.title);
  lines.push(`Pull request ${pr.url}`);
  lines.push(
    `Author: ${pr.author} · ${pr.headBranch} → ${pr.baseBranch} · state: ${pr.state}${
      pr.draft ? ' (draft)' : ''
    }${pr.merged ? ' (merged)' : ''}`,
  );
  lines.push(
    `Totals: ${pr.changedFiles} files changed, +${pr.additions} / -${pr.deletions} lines`,
  );

  lines.push('');
  lines.push('DESCRIPTION');
  lines.push(pr.body.trim().length > 0 ? truncate(pr.body.trim(), MAX_BODY_CHARS) : '(empty)');

  lines.push('');
  lines.push('CHANGED FILES');
  const listed = pr.files.slice(0, MAX_LISTED_FILES);
  for (const file of listed) {
    lines.push(`- ${file.status} ${file.filename} (+${file.additions} / -${file.deletions})`);
  }
  if (pr.files.length > listed.length) {
    lines.push(`- …and ${pr.files.length - listed.length} more files`);
  }
  if (pr.filesTruncated) {
    lines.push(
      `- NOTE: the API returned ${pr.files.length} of ${pr.changedFiles} files; the rest were not fetched.`,
    );
  }

  lines.push('');
  lines.push('PATCHES');
  let budget = MAX_TOTAL_PATCH_CHARS;
  let included = 0;
  for (const file of pr.files) {
    if (!file.patch || budget <= 0) continue;
    const patch = truncate(file.patch, Math.min(MAX_PATCH_CHARS_PER_FILE, budget));
    lines.push(`--- ${file.filename}`);
    lines.push(patch);
    budget -= patch.length;
    included += 1;
  }
  if (included === 0) lines.push('(no patch content available)');
  else if (included < pr.files.length) {
    lines.push(`…patches for ${pr.files.length - included} further files omitted for length.`);
  }

  return lines.join('\n');
}

export function toSummary(pr: PullRequestContext): PullRequestSummary {
  return {
    url: pr.url,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    baseBranch: pr.baseBranch,
    headBranch: pr.headBranch,
    changedFiles: pr.changedFiles,
    additions: pr.additions,
    deletions: pr.deletions,
    state: pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state,
    repo: `${pr.ref.owner}/${pr.ref.repo}`,
    topFiles: pr.files
      .slice()
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 6)
      .map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    filesTruncated: pr.filesTruncated,
  };
}
