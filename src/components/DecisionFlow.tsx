'use client';

import {
  providerName,
  type FlowNode,
  type Lane,
} from '@/lib/flow';
import type { AnalysisMeta } from '@/lib/types';

export { buildFlowNodes } from '@/lib/flow';
export type { FlowNode } from '@/lib/flow';

const LANE_STYLE: Record<Lane, { border: string; text: string; dot: string }> = {
  llm: { border: 'border-violet/45', text: 'text-violet', dot: 'bg-violet' },
  jev: { border: 'border-accent/45', text: 'text-accent', dot: 'bg-accent' },
  decision: { border: 'border-good/50', text: 'text-good', dot: 'bg-good' },
};

/**
 * The architecture, drawn from the run that actually happened.
 *
 * Every node below reads real state already held by the cockpit — no node has
 * a hardcoded status, and none of them can show "done" for work that did not
 * occur. The two bands exist to make one point legible in a few seconds:
 * the model supplies evidence, and the policy engine owns the decision.
 */

function Node({ node }: { node: FlowNode }) {
  const style = LANE_STYLE[node.lane];
  const dim = node.status === 'pending';

  const ring =
    node.status === 'failed'
      ? 'border-bad/60 bg-bad/[0.07]'
      : node.status === 'active'
        ? `${style.border} bg-white/[0.04]`
        : node.status === 'done'
          ? `${style.border} bg-white/[0.02]`
          : 'border-line';

  return (
    <li
      className={`min-w-0 flex-1 basis-[150px] rounded-lg border px-3 py-2.5 transition-colors ${ring} ${
        node.emphasis && node.status === 'done' ? 'ring-good/25 ring-1' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${
            node.status === 'failed'
              ? 'bg-bad'
              : node.status === 'pending'
                ? 'bg-dim/50'
                : node.status === 'active'
                  ? `${style.dot} animate-[var(--animate-blink)]`
                  : style.dot
          }`}
        />
        <p
          className={`mono truncate text-[11.5px] font-medium tracking-[0.08em] uppercase ${
            dim ? 'text-dim' : node.status === 'failed' ? 'text-bad' : style.text
          }`}
        >
          {node.label}
        </p>
      </div>
      <p
        className={`mono mt-1 truncate text-[12px] ${dim ? 'text-dim/70' : 'text-muted'}`}
        title={node.detail}
      >
        {node.detail}
      </p>
    </li>
  );
}

function ZoneLabel({ text, tone }: { text: string; tone: Lane }) {
  const colour =
    tone === 'llm' ? 'text-violet/85' : tone === 'jev' ? 'text-accent/85' : 'text-good/85';
  return (
    <p className={`mono text-[10.5px] font-medium tracking-[0.16em] uppercase ${colour}`}>{text}</p>
  );
}

function Divider({ label }: { label?: string }) {
  return (
    <div
      aria-hidden
      className="border-line flex items-center justify-center border-t pt-2 xl:h-full xl:border-t-0 xl:border-l xl:pt-0 xl:pl-2.5"
    >
      {label ? (
        <span className="mono text-dim text-[10px] tracking-[0.14em] uppercase xl:[writing-mode:vertical-rl]">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function Zone({
  label,
  tone,
  nodes,
  caption,
}: {
  label: string;
  tone: Lane;
  nodes: FlowNode[];
  caption?: string;
}) {
  return (
    <div className="min-w-0">
      <ZoneLabel text={label} tone={tone} />
      <ul className="mt-2 flex flex-wrap gap-2">
        {nodes.map((node) => (
          <Node key={node.id} node={node} />
        ))}
      </ul>
      {caption ? <p className="mt-1.5 text-[11.5px] leading-snug text-dim">{caption}</p> : null}
    </div>
  );
}

export function DecisionFlow({
  nodes,
  meta,
}: {
  nodes: FlowNode[];
  meta: AnalysisMeta | null;
}) {
  const pick = (...ids: string[]) =>
    ids.map((id) => nodes.find((n) => n.id === id)).filter((n): n is FlowNode => Boolean(n));

  const evidence = pick('source', 'llm', 'facts');
  const policy = pick('schema', 'rules');
  const outcome = pick('decision', 'actions', 'explanation');

  // Normalised once: a meta without attempts must not throw.
  const attempts = meta?.attempts ?? [];
  const failed = attempts.filter((a) => a.status === 'failed');

  return (
    <section
      aria-label="Live decision pipeline"
      className="panel animate-[var(--animate-rise)] overflow-hidden"
    >
      <header className="hairline flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <div>
          <h2 className="mono text-[12px] font-medium tracking-[0.18em] text-muted uppercase">
            Live decision pipeline
          </h2>
          <p className="mt-0.5 text-[13px] text-dim">
            The LLM provides the evidence. <span className="text-accent">Jev owns the decision.</span>
          </p>
        </div>
        {meta ? (
          <span
            className={`mono rounded-md border px-2 py-1 text-[11px] tracking-[0.1em] ${
              meta.source === 'live' ? 'border-good/40 text-good' : 'border-warn/40 text-warn'
            }`}
            title={meta.reason}
          >
            {meta.source === 'live' ? 'LIVE' : 'MOCK'} · {providerName(meta.servedBy)} · {meta.model}
          </span>
        ) : null}
      </header>

      {/* Failover, shown only when it actually happened. */}
      {failed.length > 0 ? (
        <div className="border-warn/25 bg-warn/[0.05] mono flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[11.5px]">
          {attempts.map((attempt, index) => (
            <span key={`${attempt.provider}-${index}`} className="flex items-center gap-2">
              {index > 0 ? <span className="text-dim">↓ fallback</span> : null}
              <span
                className={attempt.status === 'ok' ? 'text-good' : 'text-bad'}
                title={attempt.error}
              >
                {providerName(attempt.provider)} {attempt.status === 'ok' ? '✓' : '✕'}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 p-4 xl:grid-cols-[minmax(0,3fr)_auto_minmax(0,2fr)_auto_minmax(0,3fr)] xl:items-start">
        <Zone label="1 · Evidence — LLM" tone="llm" nodes={evidence} caption="Probabilistic. Extracts and interprets; decides nothing." />
        <Divider label="hand-off" />
        <Zone label="2 · Policy — Jev" tone="jev" nodes={policy} caption="Deterministic. Same facts always give the same result." />
        <Divider />
        <Zone label="3 · Outcome" tone="decision" nodes={outcome} caption="The explanation is written after the decision and cannot change it." />
      </div>
    </section>
  );
}
