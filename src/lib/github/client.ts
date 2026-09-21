import { refToUrl, type PullRequestRef } from './url';

/**
 * A very small GitHub REST client — two endpoints, no SDK.
 *
 * Runs server-side only. GITHUB_TOKEN, when present, raises the rate limit
 * from 60/hour to 5000/hour; it is read here and never leaves the server.
 */

export type GitHubErrorKind =
  | 'not-found'
  | 'private-or-missing'
  | 'rate-limited'
  | 'bad-credentials'
  | 'network'
  | 'unexpected';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  /** Safe to render directly in the UI. */
  readonly userMessage: string;
  readonly status?: number;

  constructor(kind: GitHubErrorKind, userMessage: string, status?: number) {
    super(userMessage);
    this.name = 'GitHubError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.status = status;
  }
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PullRequestContext {
  ref: PullRequestRef;
  url: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  draft: boolean;
  merged: boolean;
  baseBranch: string;
  headBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  files: PullRequestFile[];
  /** True when the PR has more files than the API page we fetched. */
  filesTruncated: boolean;
}

const FILE_PAGE_SIZE = 100;

/** Overridable for tests and GitHub Enterprise. Read per call, not at import. */
const apiRoot = () => process.env.GITHUB_API_URL?.trim() || 'https://api.github.com';

function headers(): Record<string, string> {
  const base: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects requests without a User-Agent.
    'User-Agent': 'JevOps-Decision-Cockpit',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

function rateLimitMessage(response: Response): string {
  const reset = response.headers.get('x-ratelimit-reset');
  const authenticated = Boolean(process.env.GITHUB_TOKEN?.trim());
  const when = reset
    ? new Date(Number(reset) * 1000).toISOString().slice(11, 16)
    : null;
  const suffix = authenticated
    ? ''
    : ' Set GITHUB_TOKEN in .env.local to raise the limit from 60 to 5000 requests an hour.';
  return `GitHub rate limit reached${when ? `, resets at ${when} UTC` : ''}.${suffix}`;
}

async function request(path: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot()}${path}`, { headers: headers(), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new GitHubError(
      'network',
      `Could not reach the GitHub API: ${(error as Error).message}`,
    );
  }

  if (response.ok) return response;

  const remaining = response.headers.get('x-ratelimit-remaining');
  if (response.status === 403 || response.status === 429) {
    if (remaining === '0') throw new GitHubError('rate-limited', rateLimitMessage(response), response.status);
    throw new GitHubError(
      'private-or-missing',
      'GitHub refused the request. The repository may be private or access-restricted.',
      response.status,
    );
  }
  if (response.status === 401) {
    throw new GitHubError(
      'bad-credentials',
      'GITHUB_TOKEN was rejected by GitHub. Check or remove it.',
      401,
    );
  }
  if (response.status === 404) {
    throw new GitHubError(
      'not-found',
      'No such pull request. It may not exist, or the repository may be private.',
      404,
    );
  }

  throw new GitHubError(
    'unexpected',
    `GitHub returned ${response.status} ${response.statusText || ''}`.trim(),
    response.status,
  );
}

async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new GitHubError('unexpected', 'GitHub returned a response that was not valid JSON.');
  }
}

interface RawPull {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  user?: { login?: string } | null;
  base?: { ref?: string } | null;
  head?: { ref?: string } | null;
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

interface RawFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

/** Fetch the PR and its changed files. Throws GitHubError with a UI-safe message. */
export async function fetchPullRequest(
  ref: PullRequestRef,
  signal?: AbortSignal,
): Promise<PullRequestContext> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}`;

  const pull = await json<RawPull>(await request(base, signal));
  if (typeof pull.number !== 'number') {
    throw new GitHubError('unexpected', 'GitHub returned a pull request without a number.');
  }

  const rawFiles = await json<RawFile[]>(
    await request(`${base}/files?per_page=${FILE_PAGE_SIZE}`, signal),
  );
  const files: PullRequestFile[] = (Array.isArray(rawFiles) ? rawFiles : []).map((f) => ({
    filename: f.filename ?? 'unknown',
    status: f.status ?? 'modified',
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    changes: f.changes ?? 0,
    patch: f.patch,
  }));

  const changedFiles = pull.changed_files ?? files.length;

  return {
    ref,
    url: refToUrl(ref),
    number: pull.number,
    title: pull.title ?? '(no title)',
    body: pull.body ?? '',
    author: pull.user?.login ?? 'unknown',
    state: pull.state ?? 'unknown',
    draft: Boolean(pull.draft),
    merged: Boolean(pull.merged),
    baseBranch: pull.base?.ref ?? 'unknown',
    headBranch: pull.head?.ref ?? 'unknown',
    changedFiles,
    additions: pull.additions ?? files.reduce((n, f) => n + f.additions, 0),
    deletions: pull.deletions ?? files.reduce((n, f) => n + f.deletions, 0),
    files,
    filesTruncated: changedFiles > files.length,
  };
}
