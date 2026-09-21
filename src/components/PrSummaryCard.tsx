'use client';

import type { PullRequestSummary } from '@/lib/types';
import { Panel, PanelHeader, Pill } from './primitives';

const STATE_TONE: Record<string, 'good' | 'warn' | 'neutral' | 'accent'> = {
  open: 'good',
  merged: 'accent',
  closed: 'neutral',
  draft: 'warn',
};

export function PrSummaryCard({ pr }: { pr: PullRequestSummary }) {
  return (
    <Panel className="animate-[var(--animate-rise)]">
      <PanelHeader
        title="Pull request"
        meta={pr.repo}
        right={<Pill tone={STATE_TONE[pr.state] ?? 'neutral'}>{pr.state}</Pill>}
      />

      <div className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-accent text-[13px] hover:underline"
          >
            #{pr.number}
          </a>
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-medium text-ink">
            {pr.title}
          </h3>
        </div>

        <p className="mono mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-dim">
          <span className="text-muted">{pr.author}</span>
          <span aria-hidden>·</span>
          <span className="text-muted">{pr.headBranch}</span>
          <span aria-hidden>→</span>
          <span className="text-muted">{pr.baseBranch}</span>
        </p>

        <div className="mono mt-3 flex flex-wrap items-center gap-3 text-[12px]">
          <span className="text-muted">
            <span className="tabular text-ink">{pr.changedFiles}</span> files
          </span>
          <span className="text-good tabular">+{pr.additions.toLocaleString()}</span>
          <span className="text-bad tabular">-{pr.deletions.toLocaleString()}</span>
        </div>
      </div>

      {pr.topFiles.length > 0 ? (
        <div className="hairline border-t px-4 py-3">
          <p className="mono text-[10px] tracking-[0.16em] text-dim uppercase">Largest changes</p>
          <ul className="mt-1.5 space-y-1">
            {pr.topFiles.map((file) => (
              <li key={file.filename} className="mono flex items-baseline gap-2 text-[11px]">
                <span className="text-dim w-[52px] shrink-0">{file.status}</span>
                <span className="min-w-0 flex-1 truncate text-muted" title={file.filename}>
                  {file.filename}
                </span>
                <span className="text-good tabular shrink-0">+{file.additions}</span>
                <span className="text-bad tabular shrink-0">-{file.deletions}</span>
              </li>
            ))}
          </ul>
          {pr.filesTruncated ? (
            <p className="mono mt-2 text-[10.5px] text-warn">
              GitHub returned the first page of files only — the analysis saw a subset.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
