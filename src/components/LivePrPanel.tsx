'use client';

import { useState } from 'react';
import type { PrExample } from '@/lib/demos';
import { Panel, PanelHeader, Pill } from './primitives';

/**
 * Live pull-request entry. The URL is validated here for immediate feedback,
 * and validated again server-side before anything is fetched.
 */
export function LivePrPanel({
  value,
  examples,
  running,
  error,
  onChange,
  onReview,
}: {
  value: string;
  examples: PrExample[];
  running: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onReview: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const empty = value.trim().length === 0;
  const shapeLooksWrong =
    touched && !empty && !/github\.com\/[^/]+\/[^/]+\/pulls?\/\d+/.test(value.trim());

  return (
    <Panel>
      <PanelHeader
        title="Live PR review"
        meta="fetches the real pull request from GitHub"
        right={<Pill tone="accent">github</Pill>}
      />

      <div className="p-4">
        <label
          htmlFor="pr-url"
          className="mono block text-[10px] tracking-[0.14em] text-dim uppercase"
        >
          Pull request URL
        </label>
        <input
          id="pr-url"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={value}
          disabled={running}
          onBlur={() => setTouched(true)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !empty && !running) {
              event.preventDefault();
              onReview();
            }
          }}
          placeholder="https://github.com/owner/repo/pull/123"
          className="mono bg-base border-line placeholder:text-dim/60 mt-1.5 w-full rounded-lg border px-3 py-2.5 text-[13px] text-ink disabled:opacity-60"
        />

        {shapeLooksWrong ? (
          <p className="mono mt-1.5 text-[11px] text-warn">
            Expected github.com/&lt;owner&gt;/&lt;repo&gt;/pull/&lt;number&gt;
          </p>
        ) : null}

        {error ? (
          <p className="border-bad/40 bg-bad/[0.07] text-bad mt-2.5 max-h-40 overflow-y-auto rounded-lg border px-3 py-2 text-[12px] leading-relaxed break-words hyphens-auto">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReview}
            disabled={empty || running}
            className="bg-accent text-base relative inline-flex items-center gap-2 overflow-hidden rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? (
              <>
                <span className="size-1.5 animate-[var(--animate-blink)] rounded-full bg-black/70" />
                Reviewing
              </>
            ) : (
              <>Review PR</>
            )}
            {running ? (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1/3 animate-[var(--animate-sweep)] bg-white/25"
              />
            ) : null}
          </button>
          <kbd className="mono border-line text-dim rounded border px-1.5 py-1 text-[10px]">↵</kbd>
          <span className="mono ml-auto text-[10px] text-dim">public repos, no auth needed</span>
        </div>
      </div>

      <div className="hairline border-t px-4 py-3">
        <p className="mono text-[10px] tracking-[0.16em] text-dim uppercase">Example pull requests</p>
        <div className="mt-2 grid gap-2">
          {examples.map((example) => (
            <button
              key={example.id}
              type="button"
              disabled={running}
              onClick={() => {
                onChange(example.url);
                setTouched(false);
              }}
              className="border-line bg-base hover:border-accent/40 group rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50"
            >
              <span className="group-hover:text-accent block text-xs font-medium text-muted transition-colors">
                {example.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-dim">{example.note}</span>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
