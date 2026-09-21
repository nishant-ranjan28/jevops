'use client';

import type { AnalysisMeta } from '@/lib/types';
import { Pill } from './primitives';

/**
 * Says plainly whether what you are looking at came from a real model call
 * or from the deterministic mock. Never inferred — it reports what ran.
 */
export function SourceBadge({
  meta,
  className = '',
}: {
  meta: AnalysisMeta;
  className?: string;
}) {
  const live = meta.source === 'live';
  return (
    <Pill tone={live ? 'good' : 'warn'} className={className}>
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${live ? 'bg-good animate-[var(--animate-blink)]' : 'bg-warn'}`}
      />
      <span title={meta.reason}>
        {live ? 'LIVE LLM' : 'MOCK LLM'} · {meta.model}
      </span>
    </Pill>
  );
}
