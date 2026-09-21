import { MODES } from './modes';
import type { ModeId } from './types';

export interface PrExample {
  id: string;
  label: string;
  note: string;
  url: string;
}

/**
 * Real, merged, public pull requests. Merged PRs are immutable, so these
 * behave identically every time they are demoed.
 */
export const PR_EXAMPLES: PrExample[] = [
  {
    id: 'axios-ssrf',
    label: 'axios #6539 — SSRF remediation',
    note: 'Security fix with regression tests · 3 files, +49 / -4',
    url: 'https://github.com/axios/axios/pull/6539',
  },
  {
    id: 'express-url',
    label: 'expressjs/express #5555',
    note: 'Small behavioural fix in URL handling · 3 files, +21 / -1',
    url: 'https://github.com/expressjs/express/pull/5555',
  },
];

export interface DemoScenario {
  id: string;
  mode: ModeId;
  label: string;
  /** What this scenario is designed to demonstrate. */
  shows: string;
  /** The designed outcome. Deterministic in mock mode. */
  expect: string;
  tone: 'bad' | 'warn' | 'good';
  conflict: boolean;
  text: string;
}

function sampleText(mode: ModeId, sampleId: string): string {
  const sample = MODES[mode].samples.find((s) => s.id === sampleId);
  if (!sample) throw new Error(`Unknown demo sample: ${mode}/${sampleId}`);
  return sample.text;
}

/**
 * One-click scenarios for a live demo, ordered as a narrative:
 * the headline conflict first, the calm baseline last.
 */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'demo-error-rate',
    mode: 'deploy-gate',
    label: 'Error rate breach',
    shows: 'Model says ship. Policy vetoes on a hard threshold.',
    expect: 'ROLLBACK · veto DEP-ERR-001',
    tone: 'bad',
    conflict: true,
    text: sampleText('deploy-gate', 'error-rate-breach'),
  },
  {
    id: 'demo-migration',
    mode: 'pr-risk',
    label: 'Irreversible migration',
    shows: 'A confident PR description hiding an unrecoverable change.',
    expect: 'BLOCK · CRITICAL',
    tone: 'bad',
    conflict: true,
    text: sampleText('pr-risk', 'ledger-migration'),
  },
  {
    id: 'demo-silent-data',
    mode: 'bug-triage',
    label: 'Quietly worded data bug',
    shows: 'Reporter says "minor". The facts say cross-tenant data corruption.',
    expect: 'S1 · page on-call',
    tone: 'bad',
    conflict: true,
    text: sampleText('bug-triage', 'silent-data'),
  },
  {
    id: 'demo-freeze',
    mode: 'deploy-gate',
    label: 'Healthy deploy in a freeze',
    shows: 'Every metric is green. A process rule still holds it.',
    expect: 'HOLD · DEP-WIN-001',
    tone: 'warn',
    conflict: true,
    text: sampleText('deploy-gate', 'freeze-window'),
  },
  {
    id: 'demo-clean',
    mode: 'deploy-gate',
    label: 'Clean rollout',
    shows: 'The baseline: model and policy agree, nothing fires.',
    expect: 'ALLOW · no conflict',
    tone: 'good',
    conflict: false,
    text: sampleText('deploy-gate', 'clean-rollout'),
  },
];
