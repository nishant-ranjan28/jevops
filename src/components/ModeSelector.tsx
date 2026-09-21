'use client';

import type { ModeId } from '@/lib/types';

export interface ModeCard {
  id: ModeId;
  label: string;
  tagline: string;
  marker: string;
  policyId: string;
  policyVersion: string;
  ruleCount: number;
}

export function ModeSelector({
  modes,
  active,
  disabled,
  onSelect,
}: {
  modes: ModeCard[];
  active: ModeId;
  disabled: boolean;
  onSelect: (mode: ModeId) => void;
}) {
  return (
    <div role="tablist" aria-label="Analysis mode" className="grid gap-3 sm:grid-cols-3">
      {modes.map((mode) => {
        const selected = mode.id === active;
        return (
          <button
            key={mode.id}
            role="tab"
            type="button"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onSelect(mode.id)}
            className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? 'border-accent/50 bg-accent/[0.07]'
                : 'border-line bg-panel hover:border-line hover:bg-raised'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`mono rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] ${
                  selected ? 'border-accent/50 text-accent' : 'border-line text-dim'
                }`}
              >
                {mode.marker}
              </span>
              <span className="mono text-[10px] text-dim">{mode.ruleCount} rules</span>
            </div>
            <h3 className={`mt-3 text-sm font-medium ${selected ? 'text-ink' : 'text-muted'}`}>
              {mode.label}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-dim">{mode.tagline}</p>
            <p className="mono mt-2 truncate text-[10px] text-dim/70">
              {mode.policyId} v{mode.policyVersion}
            </p>
            {selected ? (
              <span aria-hidden className="bg-accent absolute inset-x-0 bottom-0 h-px" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
