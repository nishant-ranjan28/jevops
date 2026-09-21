'use client';

import { Panel, PanelHeader, Pill } from './primitives';

export function ExplanationPanel({ explanation, model }: { explanation: string; model: string }) {
  return (
    <Panel className="animate-[var(--animate-rise)]">
      <PanelHeader
        title="Explanation"
        meta="the model explains the decision it did not get to make"
        right={<Pill tone="accent">{model}</Pill>}
      />
      <div className="space-y-3 p-4">
        {explanation.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index} className="text-[13.5px] leading-relaxed text-muted">
            {paragraph}
          </p>
        ))}
      </div>
    </Panel>
  );
}
