import type { FiredRule, RuleCategory } from './jev/engine';
import type { ValidationReport } from './jev/parse';

export const MODE_IDS = ['pr-risk', 'bug-triage', 'deploy-gate'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODE_IDS as readonly string[]).includes(value);
}

/** Where the language model in this run actually came from. */
export type AnalysisSource = 'live' | 'mock';

/** Common scale every mode maps onto, so LLM and Jev can be compared. */
export const STANCES = ['PROCEED', 'PROCEED_WITH_GUARDRAILS', 'HOLD', 'BLOCK'] as const;
export type Stance = (typeof STANCES)[number];

export const STANCE_RANK: Record<Stance, number> = {
  PROCEED: 0,
  PROCEED_WITH_GUARDRAILS: 1,
  HOLD: 2,
  BLOCK: 3,
};

export const STANCE_LABEL: Record<Stance, string> = {
  PROCEED: 'PROCEED',
  PROCEED_WITH_GUARDRAILS: 'PROCEED WITH GUARDRAILS',
  HOLD: 'HOLD',
  BLOCK: 'BLOCK',
};

/** The naive opinion the LLM offers before Jev runs. Never authoritative. */
export interface LlmRecommendation {
  stance: Stance;
  headline: string;
  rationale: string;
  confidence: number;
}

export interface DecisionField {
  label: string;
  value: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
  hint?: string;
}

/**
 * A single rule that forced the outcome on its own, overriding the aggregate
 * score. This is the sharpest expression of why a deterministic layer exists.
 */
export interface Veto {
  ruleId: string;
  label: string;
  /** The policy constant that was crossed, in human terms. */
  threshold: string;
}

/** Mode-agnostic shape the UI renders. Each policy projects into this. */
export interface JevDecision {
  stance: Stance;
  headline: string;
  /** Primary numeric readout, 0-100. */
  score: number;
  scoreLabel: string;
  severityLabel: string;
  fields: DecisionField[];
  /** Deterministic follow-up actions the app will execute. */
  requiredActions: string[];
  veto: Veto | null;
  policyId: string;
  policyVersion: string;
  rulesEvaluated: number;
}

export interface Divergence {
  agree: boolean;
  /** Positive when Jev is stricter than the LLM. */
  delta: number;
  llmStance: Stance;
  jevStance: Stance;
  /** Which policy rules are responsible for the gap. */
  drivers: FiredRule<string>[];
  summary: string;
}

export interface ExecutedAction {
  id: string;
  title: string;
  status: 'executed' | 'queued' | 'skipped';
  detail: string;
  payload?: Record<string, string | number | boolean>;
}

export interface FactRow {
  key: string;
  label: string;
  value: string;
  known: boolean;
  weightHint?: RuleCategory;
}

export interface StageTimings {
  fetchMs?: number;
  analyzeMs: number;
  validateMs: number;
  decideMs: number;
  actMs: number;
  explainMs: number;
  totalMs: number;
}

/** What the UI shows about a fetched pull request, before any analysis. */
export interface PullRequestSummary {
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  state: string;
  topFiles: { filename: string; status: string; additions: number; deletions: number }[];
  filesTruncated: boolean;
}

/** One provider's turn in the failover chain, as it actually played out. */
export interface ProviderAttempt {
  provider: string;
  status: 'ok' | 'failed';
  /** Present only when the attempt failed. */
  error?: string;
}

export interface AnalysisMeta {
  /** Human-readable, may describe a failover path. */
  provider: string;
  model: string;
  source: AnalysisSource;
  /** Why this provider was selected, or why we fell back. */
  reason: string;
  /** The plain id of whoever actually served the run. */
  servedBy: string;
  /** Every provider tried, in order. Drives the failover display. */
  attempts: ProviderAttempt[];
}

export interface AnalysisResult {
  mode: ModeId;
  meta: AnalysisMeta;
  input: string;
  /** Present only for a live GitHub pull-request review. */
  pullRequest: PullRequestSummary | null;
  /** How many extraction attempts the schema gate needed. */
  extractionAttempts: number;
  facts: FactRow[];
  rawFacts: Record<string, unknown>;
  unknowns: string[];
  validation: ValidationReport;
  extractionConfidence: number;
  decisionConfidence: number;
  llm: LlmRecommendation;
  decision: JevDecision;
  trace: FiredRule<string>[];
  divergence: Divergence;
  actions: ExecutedAction[];
  explanation: string;
  timings: StageTimings;
}

/**
 * The six stages the UI renders. These mirror the product thesis exactly:
 * the model bookends the pipeline and never occupies the decision seat.
 *
 * A live pull-request review swaps the first stage — the input is fetched
 * from GitHub rather than pasted — and is otherwise the identical pipeline.
 */
export interface StageDescriptor {
  id: StageId;
  label: string;
  actor: 'YOU' | 'GITHUB' | 'LLM' | 'SCHEMA' | 'JEV' | 'APP';
}

export type StageId = 'input' | 'fetch' | 'analyze' | 'facts' | 'decide' | 'act' | 'explain';

const SHARED_STAGES: StageDescriptor[] = [
  { id: 'analyze', label: 'LLM analysis', actor: 'LLM' },
  { id: 'facts', label: 'Structured facts', actor: 'SCHEMA' },
  { id: 'decide', label: 'Jev decision', actor: 'JEV' },
  { id: 'act', label: 'Deterministic action', actor: 'APP' },
  { id: 'explain', label: 'LLM explanation', actor: 'LLM' },
];

export const STAGES: StageDescriptor[] = [
  { id: 'input', label: 'Input received', actor: 'YOU' },
  ...SHARED_STAGES,
];

export const LIVE_PR_STAGES: StageDescriptor[] = [
  { id: 'fetch', label: 'Fetch pull request', actor: 'GITHUB' },
  ...SHARED_STAGES,
];

export const stagesFor = (live: boolean): StageDescriptor[] => (live ? LIVE_PR_STAGES : STAGES);

export type StageStatus = 'start' | 'done' | 'failed';

/** What the UI knows about one stage of a run. */
export interface StageView {
  status: StageStatus | 'pending';
  detail?: string;
}

/** NDJSON events streamed from /api/analyze. */
export type AnalysisEvent =
  | { type: 'meta'; meta: AnalysisMeta }
  | { type: 'pull-request'; pullRequest: PullRequestSummary; prompt: string }
  | { type: 'stage'; stage: StageId; status: StageStatus; label: string; detail?: string }
  | {
      type: 'facts';
      facts: FactRow[];
      unknowns: string[];
      validation: ValidationReport;
      extractionConfidence: number;
      llm: LlmRecommendation;
    }
  | {
      type: 'decision';
      decision: JevDecision;
      trace: FiredRule<string>[];
      divergence: Divergence;
      decisionConfidence: number;
    }
  | { type: 'actions'; actions: ExecutedAction[] }
  | { type: 'explanation'; explanation: string }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string };
