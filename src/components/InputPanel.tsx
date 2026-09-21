'use client';

import { Panel, PanelHeader } from './primitives';

export interface SampleCard {
  id: string;
  label: string;
  note: string;
  text: string;
}

export function InputPanel({
  label,
  placeholder,
  value,
  samples,
  running,
  onChange,
  onAnalyze,
  onLoadSample,
  onReset,
}: {
  label: string;
  placeholder: string;
  value: string;
  samples: SampleCard[];
  running: boolean;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  onLoadSample: (sample: SampleCard) => void;
  onReset: () => void;
}) {
  const empty = value.trim().length === 0;

  return (
    <Panel>
      <PanelHeader
        title="Input"
        meta={label}
        right={
          <span className="mono tabular text-[10px] text-dim">{value.length.toLocaleString()} ch</span>
        }
      />

      <div className="p-4">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !empty && !running) {
              event.preventDefault();
              onAnalyze();
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          rows={12}
          disabled={running}
          className="mono bg-base border-line placeholder:text-dim/60 h-64 w-full resize-y rounded-lg border p-3 text-[13px] leading-relaxed text-ink disabled:opacity-60"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={empty || running}
            className="bg-accent text-base relative inline-flex items-center gap-2 overflow-hidden rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? (
              <>
                <span className="size-1.5 animate-[var(--animate-blink)] rounded-full bg-black/70" />
                Analyzing
              </>
            ) : (
              <>Analyze</>
            )}
            {running ? (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1/3 animate-[var(--animate-sweep)] bg-white/25"
              />
            ) : null}
          </button>

          <kbd className="mono border-line text-dim rounded border px-1.5 py-1 text-[10px]">⌘↵</kbd>

          <button
            type="button"
            onClick={onReset}
            disabled={running || empty}
            className="border-line text-muted hover:text-ink ml-auto rounded-lg border px-3 py-2 text-xs transition-colors disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="hairline border-t px-4 py-3">
        <p className="mono text-[10px] tracking-[0.16em] text-dim uppercase">Demo scenarios</p>
        <div className="mt-2 grid gap-2">
          {samples.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={running}
              onClick={() => onLoadSample(sample)}
              className="border-line bg-base hover:border-accent/40 group rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50"
            >
              <span className="group-hover:text-accent block text-xs font-medium text-muted transition-colors">
                {sample.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-dim">{sample.note}</span>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
