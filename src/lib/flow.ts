import type { FiredRule } from './jev/engine';
import type { ValidationReport } from './jev/parse';
import type {
  AnalysisMeta,
  ExecutedAction,
  FactRow,
  JevDecision,
  PullRequestSummary,
  StageId,
  StageView,
} from './types';

/**
 * Derives the pipeline visualisation from the run that actually happened.
 *
 * Kept free of JSX so it can be unit tested directly: every node below reads
 * real state, and none can report progress that did not occur.
 */

export type NodeStatus = 'pending' | 'active' | 'done' | 'failed';
export type Lane = 'llm' | 'jev' | 'decision';

export interface FlowNode {
  id: string;
  label: string;
  lane: Lane;
  status: NodeStatus;
  /** One line of real measurement from the run. */
  detail: string;
  emphasis?: boolean;
}

const fmt = (n: number) => n.toLocaleString();

/** Turns the stage machine plus the presence of real data into a node status. */
function statusFrom(stage: StageView | undefined, hasData: boolean): NodeStatus {
  if (stage?.status === 'failed') return 'failed';
  if (hasData) return 'done';
  if (stage?.status === 'start') return 'active';
  if (stage?.status === 'done') return 'done';
  return 'pending';
}

export function buildFlowNodes(input: {
  live: boolean;
  stages: Record<StageId, StageView>;
  meta: AnalysisMeta | null;
  pullRequest: PullRequestSummary | null;
  facts: FactRow[];
  unknowns: string[];
  validation: ValidationReport | null;
  decision: JevDecision | null;
  trace: FiredRule<string>[];
  actions: ExecutedAction[];
  explanation: string;
  extractionAttempts: number;
}): FlowNode[] {
  const {
    live,
    stages,
    meta,
    pullRequest,
    facts,
    unknowns,
    validation,
    decision,
    trace,
    actions,
    explanation,
    extractionAttempts,
  } = input;

  const sourceStage = stages[live ? 'fetch' : 'input'];
  const resolved = facts.filter((f) => f.known).length;
  // Counted from the fact rows themselves. `unknowns` is a different thing —
  // the fields the model explicitly flagged — and conflating the two reads as
  // "one field is missing, and nothing is missing".
  const unresolved = facts.length - resolved;
  const executed = actions.filter((a) => a.status === 'executed').length;
  // `attempts` may be absent on a meta object from an older payload, so it
  // is normalised before use rather than optionally chained at each site.
  const attempts = meta?.attempts ?? [];
  const llmFailed = meta?.source === 'mock' && attempts.some((a) => a.status === 'failed');

  return [
    {
      id: 'source',
      label: live ? 'GitHub PR' : 'Input',
      lane: 'llm',
      status: statusFrom(sourceStage, pullRequest !== null || sourceStage?.status === 'done'),
      detail: pullRequest
        ? `${pullRequest.repo}#${pullRequest.number} · ${pullRequest.changedFiles} files · +${fmt(pullRequest.additions)}/-${fmt(pullRequest.deletions)}`
        : (sourceStage?.detail ?? 'awaiting input'),
    },
    {
      id: 'llm',
      label: 'Live LLM',
      lane: 'llm',
      status: llmFailed ? 'failed' : statusFrom(stages.analyze, facts.length > 0),
      detail: meta
        ? `${meta.source === 'live' ? 'LIVE' : 'MOCK'} · ${providerName(meta.servedBy)} · ${meta.model}`
        : 'no provider yet',
    },
    {
      id: 'facts',
      label: 'Structured facts',
      lane: 'llm',
      status: statusFrom(stages.facts, facts.length > 0),
      detail:
        facts.length > 0
          ? `${resolved}/${facts.length} resolved${
              unresolved > 0 ? ` · ${unresolved} unresolved` : ''
            }${unknowns.length > 0 ? ` · ${unknowns.length} flagged by model` : ''}`
          : 'not extracted yet',
    },
    {
      id: 'schema',
      label: 'Schema validation',
      lane: 'jev',
      status: statusFrom(stages.facts, validation !== null),
      detail: validation
        ? `${validation.fieldsAccepted}/${validation.fieldsTotal} accepted${
            validation.repairs.length ? ` · ${validation.repairs.length} repaired` : ' · 0 repaired'
          }${extractionAttempts > 1 ? ` · ${extractionAttempts - 1} retry` : ''}`
        : 'not validated yet',
    },
    {
      id: 'rules',
      label: 'Jev rules',
      lane: 'jev',
      status: statusFrom(stages.decide, decision !== null),
      detail: decision
        ? `${decision.rulesEvaluated} evaluated · ${trace.length} fired`
        : 'not evaluated yet',
    },
    {
      id: 'decision',
      label: 'Decision',
      lane: 'decision',
      emphasis: true,
      status: statusFrom(stages.decide, decision !== null),
      detail: decision
        ? `${decision.headline} · ${decision.score}/100${decision.veto ? ` · veto ${decision.veto.ruleId}` : ''}`
        : 'undecided',
    },
    {
      id: 'actions',
      label: 'Actions',
      lane: 'jev',
      status: statusFrom(stages.act, actions.length > 0),
      detail: actions.length > 0 ? `${executed}/${actions.length} executed` : 'none yet',
    },
    {
      id: 'explanation',
      label: 'LLM explanation',
      lane: 'llm',
      status: statusFrom(stages.explain, explanation.length > 0),
      detail:
        explanation.length > 0
          ? `${meta?.source === 'live' ? 'live' : 'template'} · informational only`
          : 'not written yet',
    },
  ];
}

export function providerName(id: string): string {
  if (id === 'openrouter') return 'OpenRouter';
  if (id === 'groq') return 'Groq';
  if (id === 'mock') return 'Mock';
  return id;
}
