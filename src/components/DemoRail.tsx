'use client';

import type { DemoScenario } from '@/lib/demos';

const TONE_RING: Record<DemoScenario['tone'], string> = {
  bad: 'border-bad/40 hover:border-bad/70',
  warn: 'border-warn/40 hover:border-warn/70',
  good: 'border-good/40 hover:border-good/70',
};

const TONE_TEXT: Record<DemoScenario['tone'], string> = {
  bad: 'text-bad',
  warn: 'text-warn',
  good: 'text-good',
};

/** One-click scenarios so a live demo never depends on typing. */
export function DemoRail({
  scenarios,
  activeId,
  disabled,
  onRun,
}: {
  scenarios: DemoScenario[];
  activeId: string | null;
  disabled: boolean;
  onRun: (scenario: DemoScenario) => void;
}) {
  return (
    <section aria-label="Demo scenarios">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="mono text-[10px] tracking-[0.18em] text-dim uppercase">
          One-click demo scenarios
        </p>
        <p className="mono text-[10px] text-dim">loads the input and runs the pipeline</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {scenarios.map((scenario) => {
          const active = scenario.id === activeId;
          return (
            <button
              key={scenario.id}
              type="button"
              disabled={disabled}
              onClick={() => onRun(scenario)}
              title={scenario.shows}
              className={`bg-panel group rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? 'border-accent/60 bg-accent/[0.06]' : TONE_RING[scenario.tone]
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`mono text-[9px] tracking-[0.12em] uppercase ${TONE_TEXT[scenario.tone]}`}>
                  {scenario.conflict ? 'conflict' : 'consensus'}
                </span>
                {active ? (
                  <span aria-hidden className="bg-accent size-1.5 rounded-full" />
                ) : null}
              </div>
              <p className="mt-1.5 text-[13px] font-medium text-ink">{scenario.label}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-dim">{scenario.shows}</p>
              <p className={`mono mt-2 text-[10px] ${TONE_TEXT[scenario.tone]}`}>{scenario.expect}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
