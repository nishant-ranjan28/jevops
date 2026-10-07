'use client';

import { STANCE_LABEL, type Divergence, type JevDecision } from '@/lib/types';

/**
 * The headline feature. When the model's instinct and the policy disagree,
 * the disagreement is the story — not a footnote under the decision.
 */
export function ConflictBanner({
  divergence,
  decision,
  onOpenTrace,
}: {
  divergence: Divergence;
  decision: JevDecision;
  onOpenTrace: () => void;
}) {
  if (divergence.agree) return null;

  const stricter = divergence.delta > 0;
  const responsible = decision.veto ?? divergence.drivers[0] ?? null;
  const responsibleId = decision.veto?.ruleId ?? divergence.drivers[0]?.id ?? null;
  const responsibleLabel = decision.veto?.label ?? divergence.drivers[0]?.label ?? null;
  const threshold = decision.veto?.threshold ?? null;

  return (
    <section
      role="alert"
      className="animate-[var(--animate-rise)] border-bad/50 bg-bad/[0.07] relative overflow-hidden rounded-xl border"
    >
      <span aria-hidden className="bg-bad absolute inset-y-0 left-0 w-[3px]" />

      <div className="flex flex-col gap-4 p-4 pl-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="mono text-bad flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] uppercase">
            <span aria-hidden className="bg-bad size-1.5 animate-[var(--animate-blink)] rounded-full" />
            Decision conflict detected
          </p>

          <div className="mono mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-dim text-[11px] tracking-[0.14em] uppercase">LLM</span>
            <span className="text-muted line-through decoration-bad/60 decoration-2">
              {STANCE_LABEL[divergence.llmStance]}
            </span>
            <span aria-hidden className="text-dim">→</span>
            <span className="text-dim text-[11px] tracking-[0.14em] uppercase">Jev</span>
            <span className="text-bad text-[1rem] font-semibold">
              {STANCE_LABEL[divergence.jevStance]}
            </span>
            <span className="border-bad/40 text-bad rounded border px-1.5 py-px text-[10px]">
              {stricter ? 'policy is stricter' : 'policy is looser'} · Δ{divergence.delta > 0 ? '+' : ''}
              {divergence.delta}
            </span>
          </div>

          {responsible ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              <span className="mono text-bad">{responsibleId}</span>
              {decision.veto ? (
                <span className="mono border-bad/40 text-bad ml-1.5 rounded border px-1 py-px text-[9px] tracking-[0.1em] uppercase">
                  hard veto
                </span>
              ) : null}{' '}
              — {responsibleLabel}
              {threshold ? (
                <>
                  {' '}
                  <span className="text-dim">({threshold})</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onOpenTrace}
          className="border-bad/50 text-bad hover:bg-bad/10 mono shrink-0 self-start rounded-lg border px-3 py-2 text-[11px] tracking-[0.1em] uppercase transition-colors sm:self-center"
        >
          Open decision trace
        </button>
      </div>
    </section>
  );
}
