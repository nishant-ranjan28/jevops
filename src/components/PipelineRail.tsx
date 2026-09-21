'use client';

import type { StageDescriptor, StageId, StageView } from '@/lib/types';
import { Panel, PanelHeader } from './primitives';

export type { StageView };

const ACTOR_TONE: Record<string, string> = {
  YOU: 'text-dim',
  GITHUB: 'text-violet',
  LLM: 'text-violet',
  SCHEMA: 'text-accent',
  JEV: 'text-good',
  APP: 'text-warn',
};

/**
 * The product thesis, rendered: the model bookends the pipeline and the
 * deterministic layer sits in the middle where the decision is made.
 */
export function PipelineRail({
  descriptors,
  stages,
  totalMs,
}: {
  descriptors: StageDescriptor[];
  stages: Record<StageId, StageView>;
  totalMs?: number;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Pipeline"
        meta="six stages · the model never holds the decision seat"
        right={
          totalMs !== undefined ? (
            <span className="mono tabular text-[10px] text-dim">{totalMs} ms</span>
          ) : null
        }
      />
      <ol className="p-2">
        {descriptors.map((stage, index) => {
          const view = stages[stage.id] ?? { status: 'pending' };
          const isJev = stage.actor === 'JEV';
          const done = view.status === 'done';
          const active = view.status === 'start';
          const failed = view.status === 'failed';

          const markClass = failed
            ? 'border-bad/60 text-bad'
            : done
              ? 'border-good/50 text-good'
              : active
                ? 'border-accent/60 text-accent animate-[var(--animate-blink)]'
                : 'border-line text-dim';

          return (
            <li key={stage.id} className="flex items-start gap-3 px-2 py-1.5">
              <div className="flex flex-col items-center pt-0.5">
                <span
                  className={`mono flex size-5 items-center justify-center rounded border text-[9px] ${markClass}`}
                >
                  {failed ? '!' : done ? '✓' : index + 1}
                </span>
                {index < descriptors.length - 1 ? (
                  <span
                    aria-hidden
                    className={`mt-1 h-6 w-px ${done ? 'bg-good/40' : 'bg-line'}`}
                  />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={`text-[13px] font-medium ${
                      failed
                        ? 'text-bad'
                        : done
                          ? 'text-ink'
                          : active
                            ? 'text-accent'
                            : 'text-dim'
                    } ${isJev ? 'tracking-tight' : ''}`}
                  >
                    {stage.label}
                  </p>
                  <span
                    className={`mono shrink-0 rounded border px-1 py-px text-[9px] tracking-[0.1em] ${
                      isJev ? 'border-good/40 text-good' : 'border-line'
                    } ${ACTOR_TONE[stage.actor] ?? 'text-dim'}`}
                  >
                    {stage.actor}
                  </span>
                </div>
                <p className="mono mt-0.5 min-h-[14px] truncate text-[10.5px] text-dim" title={view.detail}>
                  {view.detail ?? (active ? 'working…' : '')}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
