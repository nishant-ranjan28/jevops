'use client';

import type { AnalysisMeta, JevDecision } from '@/lib/types';
import { Meter, Panel, PanelHeader, Pill, ScoreRing, type Tone } from './primitives';
import { SourceBadge } from './SourceBadge';

const STANCE_TONE: Record<JevDecision['stance'], Tone> = {
  PROCEED: 'good',
  PROCEED_WITH_GUARDRAILS: 'warn',
  HOLD: 'warn',
  BLOCK: 'bad',
};

const STANCE_COPY: Record<JevDecision['stance'], string> = {
  PROCEED: 'Policy clears this to move forward.',
  PROCEED_WITH_GUARDRAILS: 'Allowed, but only with the guardrails below attached.',
  HOLD: 'Held. Conditions below must clear before this advances.',
  BLOCK: 'Blocked by policy. This does not advance.',
};

export function DecisionCard({
  decision,
  meta,
  confidence,
  extractionConfidence,
  onOpenTrace,
}: {
  decision: JevDecision;
  meta: AnalysisMeta | null;
  confidence: number;
  extractionConfidence: number;
  onOpenTrace: () => void;
}) {
  const tone = STANCE_TONE[decision.stance];
  const ringTone: Tone = decision.score >= 70 ? 'bad' : decision.score >= 45 ? 'warn' : 'good';

  const accentRing =
    tone === 'bad'
      ? 'border-bad/50 bg-bad/[0.05]'
      : tone === 'warn'
        ? 'border-warn/45 bg-warn/[0.04]'
        : 'border-good/45 bg-good/[0.04]';

  return (
    <Panel className={`animate-[var(--animate-rise)] overflow-hidden ${accentRing}`}>
      <PanelHeader
        title="Jev decision"
        meta={`${decision.policyId} v${decision.policyVersion} · ${decision.rulesEvaluated} rules`}
        right={
          <div className="flex items-center gap-2">
            {meta ? <SourceBadge meta={meta} /> : null}
            <Pill tone="accent">deterministic</Pill>
          </div>
        }
      />

      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
        <ScoreRing value={decision.score} label={decision.scoreLabel} tone={ringTone} size={148} />

        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] tracking-[0.2em] text-dim uppercase">verdict</p>
          <h2
            className={`mono mt-1 text-4xl leading-none font-semibold tracking-tight sm:text-5xl ${
              tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-good'
            }`}
          >
            {decision.headline}
          </h2>
          <p className="mt-2.5 text-sm text-muted">{STANCE_COPY[decision.stance]}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="mono text-[10px] tracking-[0.14em] text-dim uppercase">
                  Jev confidence
                </span>
                <span className="mono tabular text-[11px] text-muted">
                  {Math.round(confidence * 100)}%
                </span>
              </div>
              <div className="mt-1.5">
                <Meter
                  value={confidence * 100}
                  tone={confidence >= 0.7 ? 'good' : confidence >= 0.45 ? 'warn' : 'bad'}
                />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="mono text-[10px] tracking-[0.14em] text-dim uppercase">
                  Extraction quality
                </span>
                <span className="mono tabular text-[11px] text-muted">
                  {Math.round(extractionConfidence * 100)}%
                </span>
              </div>
              <div className="mt-1.5">
                <Meter value={extractionConfidence * 100} tone="accent" />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenTrace}
            className="border-line text-muted hover:border-accent/50 hover:text-accent mono mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase transition-colors"
          >
            Decision trace
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>

      {decision.veto ? (
        <div className="border-bad/30 bg-bad/[0.07] flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t px-5 py-3">
          <span className="mono text-bad text-[10px] font-semibold tracking-[0.16em] uppercase">
            Hard veto
          </span>
          <span className="mono text-bad text-[12px]">{decision.veto.ruleId}</span>
          <span className="text-[12px] text-muted">— {decision.veto.label}.</span>
          <span className="mono text-[11px] text-dim">{decision.veto.threshold}</span>
        </div>
      ) : null}

      <div className="hairline grid grid-cols-2 gap-px border-t bg-[var(--color-line-soft)] sm:grid-cols-3 lg:grid-cols-4">
        {decision.fields.map((field) => (
          <div key={field.label} className="bg-panel px-4 py-3">
            <p className="mono text-[10px] tracking-[0.12em] text-dim uppercase">{field.label}</p>
            <p
              className={`mono mt-1 text-sm font-medium ${
                field.tone === 'bad'
                  ? 'text-bad'
                  : field.tone === 'warn'
                    ? 'text-warn'
                    : field.tone === 'good'
                      ? 'text-good'
                      : 'text-ink'
              }`}
              title={field.hint}
            >
              {field.value}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
