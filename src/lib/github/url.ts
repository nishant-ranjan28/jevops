/**
 * Pull request URL parsing.
 *
 * Deliberately strict: we accept the shapes GitHub actually produces and
 * reject everything else with a reason the UI can show, rather than guessing
 * at what the user meant and fetching the wrong thing.
 */

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export type ParseResult =
  | { ok: true; ref: PullRequestRef }
  | { ok: false; reason: string };

/** GitHub's own rules: 1-39 chars, alphanumerics and hyphens, no leading hyphen. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Repo names additionally allow dots and underscores. */
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parsePullRequestUrl(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Enter a GitHub pull request URL.' };

  // Accept a bare owner/repo#123 or owner/repo/pull/123 shorthand too.
  const shorthand = trimmed.match(/^([^/\s]+)\/([^/\s#]+)(?:#|\/pull\/)(\d+)$/);
  if (shorthand) {
    return validate(shorthand[1], shorthand[2], shorthand[3]);
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return {
      ok: false,
      reason: `Only github.com pull requests are supported (got ${url.hostname}).`,
    };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const pullIndex = segments.findIndex((s) => s === 'pull' || s === 'pulls');
  if (segments.length < 4 || pullIndex !== 2) {
    return {
      ok: false,
      reason: 'Expected a URL of the form https://github.com/<owner>/<repo>/pull/<number>.',
    };
  }

  return validate(segments[0], segments[1], segments[3]);
}

function validate(owner: string, repo: string, rawNumber: string): ParseResult {
  const cleanRepo = repo.replace(/\.git$/, '');

  if (!OWNER.test(owner)) return { ok: false, reason: `"${owner}" is not a valid GitHub owner.` };
  if (!REPO.test(cleanRepo)) {
    return { ok: false, reason: `"${cleanRepo}" is not a valid GitHub repository name.` };
  }

  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, reason: `"${rawNumber}" is not a valid pull request number.` };
  }

  return { ok: true, ref: { owner, repo: cleanRepo, number } };
}

export const refToUrl = (ref: PullRequestRef) =>
  `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
