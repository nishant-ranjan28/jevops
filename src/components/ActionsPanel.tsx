'use client';

import type { ExecutedAction } from '@/lib/types';
import { Dot, Panel, PanelHeader, type Tone } from './primitives';

const STATUS_TONE: Record<ExecutedAction['status'], Tone> = {
  executed: 'good',
  queued: 'warn',
  skipped: 'neutral',
};

export function ActionsPanel({
  actions,
  requiredActions,
}: {
  actions: ExecutedAction[];
  requiredActions: string[];
}) {
  return (
    <Panel className="animate-[var(--animate-rise)]">
      <PanelHeader title="Deterministic actions" meta="executed by the application, not by the model" />

      <ul className="divide-y divide-[var(--color-line-soft)]">
        {actions.map((action) => (
          <li key={action.id} className="flex items-start gap-3 px-4 py-3">
            <span className="pt-1.5">
              <Dot tone={STATUS_TONE[action.status]} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-[13px] font-medium text-ink">{action.title}</p>
                <span
                  className={`mono text-[10px] tracking-[0.12em] uppercase ${
                    action.status === 'executed'
                      ? 'text-good'
                      : action.status === 'queued'
                        ? 'text-warn'
                        : 'text-dim'
                  }`}
                >
                  {action.status}
                </span>
              </div>
              <p className="mono mt-0.5 text-[11px] break-words text-muted">{action.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="hairline border-t px-4 py-3">
        <p className="mono text-[10px] tracking-[0.16em] text-dim uppercase">Required of the team</p>
        <ul className="mt-2 space-y-1.5">
          {requiredActions.map((item) => (
            <li key={item} className="flex gap-2 text-[13px] text-muted">
              <span className="text-accent mono">→</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
