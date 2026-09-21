'use client';

import { STANCE_LABEL, type Divergence, type JevDecision, type LlmRecommendation } from '@/lib/types';
import { Panel, PanelHeader, Pill } from './primitives';

function stanceColor(stance: string): string {
  if (stance === 'BLOCK') return 'text-bad';
  if (stance === 'HOLD' || stance === 'PROCEED_WITH_GUARDRAILS') return 'text-warn';
  return 'text-good';
}

export function DivergencePanel({
  llm,
  divergence,
  decision,
}: {
  llm: LlmRecommendation;
  divergence: Divergence;
  decision: JevDecision;
}) {
  const conflict = !divergence.agree;

  return (
    <Panel
      className={`animate-[var(--animate-rise)] overflow-hidden ${
        conflict ? 'border-bad/45' : 'border-good/30'
      }`}
    >
      <PanelHeader
        title="LLM vs Jev"
        meta={conflict ? 'the model and the policy do not agree' : 'model and policy are aligned'}
        right={
          conflict ? (
            <Pill tone="bad">policy override</Pill>
          ) : (
            <Pill tone="good">consensus</Pill>
          )
        }
      />

      <div className="grid gap-px bg-[var(--color-line-soft)] sm:grid-cols-[1fr_auto_1fr]">
        <div className="bg-panel p-4">
          <p className="mono text-[10px] tracking-[0.18em] text-dim uppercase">LLM recommendation</p>
          <p className={`mono mt-2 text-lg font-semibold ${stanceColor(llm.stance)}`}>
            {STANCE_LABEL[llm.stance]}
          </p>
          <p className="mt-1 text-xs text-muted">{llm.headline}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">{llm.rationale}</p>
          <p className="mono mt-3 text-[10px] text-dim">
            self-reported confidence {Math.round(llm.confidence * 100)}%
          </p>
        </div>

        <div className="bg-panel flex items-center justify-center px-4 py-2 sm:px-3">
          <span
            className={`mono rounded-md border px-2 py-1 text-[10px] tracking-[0.14em] uppercase ${
              conflict ? 'border-bad/50 text-bad' : 'border-good/40 text-good'
            }`}
          >
            {conflict ? `Δ ${divergence.delta > 0 ? '+' : ''}${divergence.delta}` : 'match'}
          </span>
        </div>

        <div className="bg-panel p-4">
          <p className="mono text-[10px] tracking-[0.18em] text-dim uppercase">Jev decision</p>
          <p className={`mono mt-2 text-lg font-semibold ${stanceColor(divergence.jevStance)}`}>
            {STANCE_LABEL[divergence.jevStance]}
          </p>
          <p className="mt-1 text-xs text-muted">{decision.headline}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">{divergence.summary}</p>
          {decision.veto ? (
            <p className="mono border-bad/40 bg-bad/[0.07] text-bad mt-3 rounded border px-2 py-1.5 text-[11px]">
              veto {decision.veto.ruleId} — {decision.veto.threshold}
            </p>
          ) : null}
          {divergence.drivers.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {divergence.drivers.map((driver) => (
                <li key={driver.id} className="mono text-[11px] text-dim">
                  <span className={conflict ? 'text-bad' : 'text-good'}>{driver.id}</span> — {driver.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {conflict ? (
        <p className="border-bad/25 bg-bad/[0.06] text-bad/90 border-t px-4 py-3 text-xs">
          This is why the decision layer exists. The model read the prose; Jev read the facts against fixed
          thresholds. When they disagree, the policy is authoritative and the model only gets to explain it.
        </p>
      ) : null}
    </Panel>
  );
}
