import { Cockpit, type CockpitMode } from '@/components/Cockpit';
import { DEMO_SCENARIOS, PR_EXAMPLES } from '@/lib/demos';
import { resolveProvider } from '@/lib/llm/provider';
import { MODE_LIST } from '@/lib/modes';
import type { AnalysisMeta } from '@/lib/types';

/** Rendered per request so the LIVE/MOCK badge is correct on first paint. */
export const dynamic = 'force-dynamic';

/**
 * Server component. The mode registry holds functions, so only the
 * serializable metadata crosses into the client bundle. Provider keys are
 * read here and never leave the server — only the resolved name and model do.
 */
export default function Home() {
  const modes: CockpitMode[] = MODE_LIST.map((mode) => ({
    id: mode.id,
    label: mode.label,
    tagline: mode.tagline,
    marker: mode.marker,
    policyId: mode.policyId,
    policyVersion: mode.policyVersion,
    ruleCount: mode.ruleCount,
    inputLabel: mode.inputLabel,
    placeholder: mode.placeholder,
    samples: mode.samples.map((sample) => ({ ...sample })),
  }));

  const { provider, reason } = resolveProvider();
  const configuredProvider: AnalysisMeta = {
    provider: provider.id,
    model: provider.model,
    source: provider.isMock ? 'mock' : 'live',
    reason,
    servedBy: provider.id,
    // Nothing has run yet, so there is no attempt history to show.
    attempts: [],
  };

  return (
    <Cockpit
      modes={modes}
      scenarios={DEMO_SCENARIOS.map((s) => ({ ...s }))}
      prExamples={PR_EXAMPLES.map((e) => ({ ...e }))}
      configuredProvider={configuredProvider}
    />
  );
}
