'use client';

import type { ValidationReport } from '@/lib/jev/parse';
import type { FactRow } from '@/lib/types';
import { Panel, PanelHeader, Pill } from './primitives';

export function FactsPanel({
  facts,
  unknowns,
  validation,
}: {
  facts: FactRow[];
  unknowns: string[];
  validation: ValidationReport | null;
}) {
  const known = facts.filter((f) => f.known).length;
  const repairs = validation?.repairs ?? [];

  return (
    <Panel className="animate-[var(--animate-rise)]">
      <PanelHeader
        title="Structured facts"
        meta="schema-validated model output — not a decision"
        right={
          <div className="flex items-center gap-2">
            <Pill tone={repairs.length > 0 ? 'bad' : 'good'}>
              {repairs.length > 0 ? `${repairs.length} repaired` : 'schema ok'}
            </Pill>
            <Pill tone={unknowns.length > 0 ? 'warn' : 'good'}>
              {known}/{facts.length} resolved
            </Pill>
          </div>
        }
      />
      <dl className="grid gap-px bg-[var(--color-line-soft)] sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.key} className="bg-panel px-4 py-2.5">
            <dt className="mono text-[10px] tracking-[0.1em] text-dim uppercase">{fact.label}</dt>
            <dd
              className={`mono mt-0.5 truncate text-[13px] ${fact.known ? 'text-ink' : 'text-dim italic'}`}
              title={fact.value}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {repairs.length > 0 ? (
        <div className="border-bad/25 bg-bad/[0.05] border-t px-4 py-3">
          <p className="mono text-bad text-[10px] tracking-[0.14em] uppercase">
            Schema repairs — rejected before Jev saw them
          </p>
          <ul className="mt-1.5 space-y-1">
            {repairs.map((repair) => (
              <li key={repair.field} className="mono text-[11px] text-muted">
                <span className="text-bad">{repair.field}</span>: {repair.received} → policy default{' '}
                <span className="text-dim">({repair.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unknowns.length > 0 ? (
        <p className="hairline border-t px-4 py-3 text-xs text-warn/90">
          <span className="mono tracking-[0.12em] uppercase">unknowns</span> — the model declined to
          guess: <span className="mono text-warn">{unknowns.join(', ')}</span>. Jev discounts its own
          confidence for each one.
        </p>
      ) : null}
    </Panel>
  );
}
