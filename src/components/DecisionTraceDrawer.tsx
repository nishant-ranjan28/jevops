'use client';

import { useEffect } from 'react';
import type { FiredRule } from '@/lib/jev/engine';
import type { ValidationReport } from '@/lib/jev/parse';
import {
  STANCE_LABEL,
  type AnalysisMeta,
  type Divergence,
  type ExecutedAction,
  type FactRow,
  type JevDecision,
  type LlmRecommendation,
} from '@/lib/types';

function Step({
  index,
  title,
  actor,
  children,
}: {
  index: number;
  title: string;
  actor: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-8">
      <span className="mono border-line bg-raised text-dim absolute top-0 left-0 flex size-5 items-center justify-center rounded border text-[9px]">
        {index}
      </span>
      <span aria-hidden className="bg-line absolute top-6 bottom-0 left-[9px] w-px" />
      <div className="pb-6">
        <div className="flex items-baseline gap-2">
          <h3 className="mono text-[11px] font-medium tracking-[0.14em] text-ink uppercase">{title}</h3>
          <span className="mono border-line text-dim rounded border px-1 py-px text-[9px]">{actor}</span>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * The full chain of custody for one decision:
 * facts → rules → arithmetic → veto → verdict → action.
 * This is the product's differentiator made inspectable.
 */
export function DecisionTraceDrawer({
  open,
  onClose,
  meta,
  facts,
  validation,
  llm,
  decision,
  trace,
  divergence,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  meta: AnalysisMeta | null;
  facts: FactRow[];
  validation: ValidationReport | null;
  llm: LlmRecommendation;
  decision: JevDecision;
  trace: FiredRule<string>[];
  divergence: Divergence;
  actions: ExecutedAction[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const positive = trace.filter((r) => r.weight > 0);
  const negative = trace.filter((r) => r.weight < 0);
  const rawSum = trace.reduce((sum, r) => sum + r.weight, 0);
  const clamped = rawSum !== decision.score;
  const known = facts.filter((f) => f.known).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close decision trace"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Decision trace"
        className="bg-panel border-line animate-[var(--animate-rise)] relative flex h-full w-full max-w-[560px] flex-col border-l shadow-2xl"
      >
        <header className="hairline flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="mono text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
              Decision trace
            </h2>
            <p className="mono mt-0.5 text-[10px] text-dim">
              {decision.policyId} v{decision.policyVersion} · {meta ? meta.source.toUpperCase() : '—'} model
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-line text-muted hover:text-ink mono rounded-md border px-2 py-1 text-[10px] tracking-[0.1em] uppercase transition-colors"
          >
            Esc
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <ol>
            <Step index={1} title="LLM facts" actor={meta?.source === 'live' ? 'LIVE LLM' : 'MOCK LLM'}>
              <p className="text-[12px] text-muted">
                {known} of {facts.length} fields resolved from the input.
                {validation
                  ? ` Schema accepted ${validation.fieldsAccepted}/${validation.fieldsTotal} fields${
                      validation.repairs.length ? `, repaired ${validation.repairs.length}.` : ' with no repairs.'
                    }`
                  : ''}
              </p>
              {validation && validation.repairs.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {validation.repairs.map((repair) => (
                    <li key={repair.field} className="mono text-[11px] text-warn">
                      {repair.field}: {repair.received} → default ({repair.reason})
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mono mt-2 text-[11px] text-dim">
                model recommendation: {STANCE_LABEL[llm.stance]} — not binding
              </p>
            </Step>

            <Step index={2} title="Jev rules fired" actor="JEV">
              <p className="text-[12px] text-muted">
                {decision.rulesEvaluated} rules evaluated, {trace.length} fired.
              </p>
              {trace.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {trace.map((rule) => (
                    <li key={rule.id} className="mono flex items-baseline gap-2 text-[11px]">
                      <span className={rule.weight > 0 ? 'text-bad' : 'text-good'}>
                        {rule.weight > 0 ? '+' : ''}
                        {rule.weight}
                      </span>
                      <span className="text-accent">{rule.id}</span>
                      <span className="min-w-0 flex-1 text-dim">{rule.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mono mt-2 text-[11px] text-dim">No rule matched the extracted facts.</p>
              )}
            </Step>

            <Step index={3} title="Score calculation" actor="JEV">
              <div className="border-line bg-base rounded-lg border p-3">
                <p className="mono text-[11px] text-dim">
                  {positive.length} escalating {positive.length === 1 ? 'rule' : 'rules'} (+
                  {positive.reduce((s, r) => s + r.weight, 0)}), {negative.length} mitigating (
                  {negative.reduce((s, r) => s + r.weight, 0)})
                </p>
                <p className="mono mt-2 text-[13px] text-ink">
                  Σ weights = {rawSum}
                  {clamped ? (
                    <span className="text-warn"> → clamped to 0–100 → {decision.score}</span>
                  ) : (
                    <span className="text-dim"> → {decision.scoreLabel.toLowerCase()} {decision.score}</span>
                  )}
                </p>
                <p className="mono mt-1 text-[11px] text-dim">severity band: {decision.severityLabel}</p>
              </div>
            </Step>

            <Step index={4} title="Veto / threshold" actor="JEV">
              {decision.veto ? (
                <div className="border-bad/40 bg-bad/[0.06] rounded-lg border p-3">
                  <p className="mono text-bad text-[12px] font-medium">{decision.veto.ruleId}</p>
                  <p className="mt-1 text-[12px] text-muted">{decision.veto.label}</p>
                  <p className="mono mt-2 text-[11px] text-bad/90">{decision.veto.threshold}</p>
                  <p className="mt-2 text-[11px] text-dim">
                    A veto sets the outcome on its own. The aggregate score did not get a vote.
                  </p>
                </div>
              ) : (
                <p className="text-[12px] text-muted">
                  No hard veto fired. The outcome came from the aggregate score and its severity band.
                </p>
              )}
            </Step>

            <Step index={5} title="Final decision" actor="JEV">
              <div className="border-line bg-base rounded-lg border p-3">
                <p className="mono text-[15px] font-semibold text-ink">{decision.headline}</p>
                <p className="mono mt-1 text-[11px] text-dim">stance: {STANCE_LABEL[decision.stance]}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {decision.fields.map((field) => (
                    <div key={field.label} className="flex justify-between gap-2">
                      <dt className="mono truncate text-[10.5px] text-dim">{field.label}</dt>
                      <dd className="mono shrink-0 text-[10.5px] text-muted">{field.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mono mt-2 text-[11px] text-dim">
                  model said {STANCE_LABEL[divergence.llmStance]} ·{' '}
                  {divergence.agree ? 'agreed' : `overridden (Δ${divergence.delta > 0 ? '+' : ''}${divergence.delta})`}
                </p>
              </div>
            </Step>

            <Step index={6} title="Deterministic action" actor="APP">
              <ul className="space-y-1.5">
                {actions.map((action) => (
                  <li key={action.id} className="text-[12px]">
                    <span
                      className={`mono mr-2 text-[10px] tracking-[0.1em] uppercase ${
                        action.status === 'executed'
                          ? 'text-good'
                          : action.status === 'queued'
                            ? 'text-warn'
                            : 'text-dim'
                      }`}
                    >
                      {action.status}
                    </span>
                    <span className="text-muted">{action.title}</span>
                    <span className="mono block pl-1 text-[10.5px] text-dim">{action.detail}</span>
                  </li>
                ))}
              </ul>
            </Step>
          </ol>
        </div>
      </aside>
    </div>
  );
}
