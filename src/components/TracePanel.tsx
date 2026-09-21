'use client';

import { useState } from 'react';
import type { FiredRule } from '@/lib/jev/engine';
import type { Veto } from '@/lib/types';
import { Panel, PanelHeader, Pill } from './primitives';

const CATEGORY_TONE: Record<string, string> = {
  security: 'text-bad',
  reliability: 'text-warn',
  'blast-radius': 'text-violet',
  coverage: 'text-accent',
  operational: 'text-warn',
  impact: 'text-bad',
  process: 'text-muted',
};

const PREVIEW_COUNT = 4;

export function TracePanel({
  trace,
  rulesEvaluated,
  veto,
}: {
  trace: FiredRule<string>[];
  rulesEvaluated: number;
  veto: Veto | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = trace.reduce((sum, rule) => sum + rule.weight, 0);
  const visible = expanded ? trace : trace.slice(0, PREVIEW_COUNT);
  const hidden = trace.length - visible.length;

  return (
    <Panel className="animate-[var(--animate-rise)]">
      <PanelHeader
        title="Policy trace"
        meta={`${trace.length} of ${rulesEvaluated} rules fired, in weight order`}
        right={
          <Pill tone={total > 0 ? 'warn' : 'good'}>
            Σ {total > 0 ? '+' : ''}
            {total}
          </Pill>
        }
      />
      {trace.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-dim">
          No rule fired. The facts do not meet any escalation condition in this policy.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {visible.map((rule) => {
              const isVeto = veto?.ruleId === rule.id;
              return (
                <li
                  key={rule.id}
                  className={`flex items-start gap-3 px-4 py-2.5 ${isVeto ? 'bg-bad/[0.06]' : ''}`}
                >
                  <span className="mono text-accent w-[86px] shrink-0 text-[11px]">{rule.id}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-ink">
                      {rule.label}
                      {isVeto ? (
                        <span className="mono border-bad/40 text-bad ml-2 rounded border px-1 py-px text-[9px] tracking-[0.1em] uppercase">
                          veto
                        </span>
                      ) : null}
                    </p>
                    <p className="mono mt-0.5 text-[10px] tracking-[0.1em] uppercase">
                      <span className={CATEGORY_TONE[rule.category] ?? 'text-dim'}>{rule.category}</span>
                      {rule.flags.length > 0 ? (
                        <span className="text-dim"> · {rule.flags.join(' · ')}</span>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`mono tabular shrink-0 text-[13px] font-medium ${
                      rule.weight > 0 ? 'text-bad' : rule.weight < 0 ? 'text-good' : 'text-dim'
                    }`}
                  >
                    {rule.weight > 0 ? '+' : ''}
                    {rule.weight}
                  </span>
                </li>
              );
            })}
          </ul>

          {trace.length > PREVIEW_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="hairline mono text-dim hover:text-accent w-full border-t px-4 py-2.5 text-[11px] tracking-[0.1em] uppercase transition-colors"
            >
              {expanded ? 'Show fewer' : `Show ${hidden} more fired rule${hidden === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}
