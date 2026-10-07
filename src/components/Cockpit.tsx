'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FiredRule } from '@/lib/jev/engine';
import type { ValidationReport } from '@/lib/jev/parse';
import type { DemoScenario, PrExample } from '@/lib/demos';
import {
  stagesFor,
  type AnalysisEvent,
  type AnalysisMeta,
  type Divergence,
  type ExecutedAction,
  type FactRow,
  type JevDecision,
  type LlmRecommendation,
  type ModeId,
  type PullRequestSummary,
  type StageId,
  type StageTimings,
} from '@/lib/types';
import { ActionsPanel } from './ActionsPanel';
import { ConflictBanner } from './ConflictBanner';
import { DecisionCard } from './DecisionCard';
import { buildFlowNodes, DecisionFlow } from './DecisionFlow';
import { DecisionTraceDrawer } from './DecisionTraceDrawer';
import { DemoRail } from './DemoRail';
import { DivergencePanel } from './DivergencePanel';
import { ExplanationPanel } from './ExplanationPanel';
import { FactsPanel } from './FactsPanel';
import { InputPanel, type SampleCard } from './InputPanel';
import { LivePrPanel } from './LivePrPanel';
import { PrSummaryCard } from './PrSummaryCard';
import { ModeSelector, type ModeCard } from './ModeSelector';
import { PipelineRail, type StageView } from './PipelineRail';
import { Panel } from './primitives';
import { SourceBadge } from './SourceBadge';
import { TracePanel } from './TracePanel';

export interface CockpitMode extends ModeCard {
  inputLabel: string;
  placeholder: string;
  samples: SampleCard[];
}

interface Analysis {
  facts: FactRow[];
  unknowns: string[];
  validation: ValidationReport | null;
  extractionConfidence: number;
  llm: LlmRecommendation;
  decision: JevDecision | null;
  trace: FiredRule<string>[];
  divergence: Divergence | null;
  decisionConfidence: number;
  actions: ExecutedAction[];
  explanation: string;
  extractionAttempts: number;
  timings?: StageTimings;
}

function blankAnalysis(): Analysis {
  return {
    facts: [],
    unknowns: [],
    validation: null,
    extractionConfidence: 0,
    llm: { stance: 'PROCEED', headline: '', rationale: '', confidence: 0 },
    decision: null,
    trace: [],
    divergence: null,
    decisionConfidence: 0,
    actions: [],
    explanation: '',
    extractionAttempts: 1,
  };
}

const ALL_STAGE_IDS: StageId[] = ['input', 'fetch', 'analyze', 'facts', 'decide', 'act', 'explain'];

const PENDING_STAGES = (): Record<StageId, StageView> =>
  Object.fromEntries(ALL_STAGE_IDS.map((id) => [id, { status: 'pending' as const }])) as Record<
    StageId,
    StageView
  >;

type InputSource = 'paste' | 'live-pr';

/** Only the PR risk policy has a meaningful live GitHub source. */
const LIVE_PR_MODE: ModeId = 'pr-risk';

const REPO_URL = 'https://github.com/nishant-ranjan28/jevops';
const AUTHOR_URL = 'https://github.com/nishant-ranjan28';

function GitHubMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Cockpit({
  modes,
  scenarios,
  prExamples,
  configuredProvider,
}: {
  modes: CockpitMode[];
  scenarios: DemoScenario[];
  prExamples: PrExample[];
  /** What is configured server-side, shown before any run has happened. */
  configuredProvider: AnalysisMeta;
}) {
  const [modeId, setModeId] = useState<ModeId>(modes[0].id);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<StageId, StageView>>(PENDING_STAGES);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [meta, setMeta] = useState<AnalysisMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeDemo, setActiveDemo] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [inputSource, setInputSource] = useState<InputSource>('paste');
  const [prUrl, setPrUrl] = useState('');
  const [pullRequest, setPullRequest] = useState<PullRequestSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearResults = useCallback(() => {
    setAnalysis(null);
    setMeta(null);
    setStages(PENDING_STAGES());
    setNotice(null);
    setTraceOpen(false);
    setPullRequest(null);
  }, []);

  const applyEvent = useCallback((event: AnalysisEvent) => {
    switch (event.type) {
      case 'meta':
        setMeta(event.meta);
        break;
      case 'pull-request':
        setPullRequest(event.pullRequest);
        break;
      case 'stage':
        setStages((prev) => ({
          ...prev,
          [event.stage]: {
            status: event.status,
            detail: event.detail ?? prev[event.stage]?.detail,
          },
        }));
        break;
      case 'facts':
        setAnalysis((prev) => ({
          ...(prev ?? blankAnalysis()),
          facts: event.facts,
          unknowns: event.unknowns,
          validation: event.validation,
          extractionConfidence: event.extractionConfidence,
          llm: event.llm,
        }));
        break;
      case 'decision':
        setAnalysis((prev) => ({
          ...(prev ?? blankAnalysis()),
          decision: event.decision,
          trace: event.trace,
          divergence: event.divergence,
          decisionConfidence: event.decisionConfidence,
        }));
        break;
      case 'actions':
        setAnalysis((prev) => ({ ...(prev ?? blankAnalysis()), actions: event.actions }));
        break;
      case 'explanation':
        setAnalysis((prev) => ({ ...(prev ?? blankAnalysis()), explanation: event.explanation }));
        break;
      case 'result':
        setAnalysis((prev) => ({
          ...(prev ?? blankAnalysis()),
          timings: event.result.timings,
          extractionAttempts: event.result.extractionAttempts,
        }));
        break;
      case 'error':
        setNotice(event.message);
        break;
    }
  }, []);

  const analyze = useCallback(
    async (targetMode: ModeId, text: string, livePrUrl?: string) => {
      const live = Boolean(livePrUrl?.trim());
      if (!live && !text.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setNotice(null);
      setStages(PENDING_STAGES());
      setAnalysis(null);
      setMeta(null);
      setTraceOpen(false);
      setPullRequest(null);

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: targetMode,
            input: text,
            ...(live ? { prUrl: livePrUrl } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.text();
          let message = detail.slice(0, 300);
          try {
            const parsed = JSON.parse(detail) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            // Not JSON — fall back to the raw body.
          }
          throw new Error(message || `Request failed with ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            applyEvent(JSON.parse(line) as AnalysisEvent);
          }
        }
        if (buffer.trim()) applyEvent(JSON.parse(buffer) as AnalysisEvent);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setNotice(error instanceof Error ? error.message : 'Analysis failed.');
        }
      } finally {
        setRunning(false);
      }
    },
    [applyEvent],
  );

  const runDemo = useCallback(
    (scenario: DemoScenario) => {
      setModeId(scenario.mode);
      setInputSource('paste');
      setInput(scenario.text);
      setActiveDemo(scenario.id);
      void analyze(scenario.mode, scenario.text);
    },
    [analyze],
  );

  const liveMode = modeId === LIVE_PR_MODE && inputSource === 'live-pr';
  const descriptors = stagesFor(liveMode);
  const activeStage = descriptors.find((s) => stages[s.id]?.status === 'start');
  const decision = analysis?.decision ?? null;

  const reviewPr = () => void analyze(LIVE_PR_MODE, '', prUrl);

  const started = running || analysis !== null;
  const flowNodes = buildFlowNodes({
    live: liveMode,
    stages,
    meta,
    pullRequest,
    facts: analysis?.facts ?? [],
    unknowns: analysis?.unknowns ?? [],
    validation: analysis?.validation ?? null,
    decision: analysis?.decision ?? null,
    trace: analysis?.trace ?? [],
    actions: analysis?.actions ?? [],
    explanation: analysis?.explanation ?? '',
    extractionAttempts: analysis?.extractionAttempts ?? 1,
  });

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 -z-10" />

      <header className="border-line bg-base/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="mono text-accent text-sm font-semibold tracking-[0.2em]">JEVOPS</span>
            <span className="mono hidden text-[10px] tracking-[0.14em] text-dim uppercase sm:inline">
              engineering decision cockpit
            </span>
          </div>

          <nav
            aria-label="Pipeline"
            className="mono hidden items-center gap-1.5 text-[10px] text-dim xl:flex"
          >
            {descriptors.map((stage, index) => {
              const state = stages[stage.id]?.status ?? 'pending';
              const isJev = stage.actor === 'JEV';
              return (
                <span key={stage.id} className="flex items-center gap-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 transition-colors ${
                      state === 'done'
                        ? 'border-good/45 text-good'
                        : state === 'start'
                          ? 'border-accent/60 text-accent'
                          : isJev
                            ? 'border-line text-muted'
                            : 'border-line text-dim'
                    }`}
                  >
                    {stage.actor}
                  </span>
                  {index < descriptors.length - 1 ? <span aria-hidden>→</span> : null}
                </span>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SourceBadge meta={meta ?? configuredProvider} />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="JevOps source code on GitHub"
              className="border-line text-muted hover:text-ink hover:border-accent/60 mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] tracking-[0.12em] uppercase transition-colors"
            >
              <GitHubMark />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            The model reads the mess. <span className="text-accent">Jev</span> makes the call.
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted">
            An LLM turns unstructured engineering input into typed facts. Those facts pass a schema
            gate. A deterministic policy engine turns them into a decision, the application executes
            it, and the model only gets the last word on the explanation — never on the outcome.
          </p>
        </div>

        <div className="mb-6">
          <DemoRail
            scenarios={scenarios}
            activeId={activeDemo}
            disabled={running}
            onRun={runDemo}
          />
        </div>

        <div className="mb-6">
          <ModeSelector
            modes={modes}
            active={modeId}
            disabled={running}
            onSelect={(next) => {
              setModeId(next);
              setActiveDemo(null);
              if (next !== LIVE_PR_MODE) setInputSource('paste');
              clearResults();
            }}
          />
        </div>

        {notice && !liveMode ? (
          <div className="border-warn/40 bg-warn/[0.07] text-warn mb-6 rounded-lg border px-4 py-3 text-xs">
            {notice}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {modeId === LIVE_PR_MODE ? (
              <div
                role="tablist"
                aria-label="Input source"
                className="border-line bg-panel grid grid-cols-2 gap-1 rounded-lg border p-1"
              >
                {(
                  [
                    ['paste', 'Paste input'],
                    ['live-pr', 'Live PR review'],
                  ] as [InputSource, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    type="button"
                    aria-selected={inputSource === id}
                    disabled={running}
                    onClick={() => {
                      setInputSource(id);
                      setActiveDemo(null);
                      clearResults();
                    }}
                    className={`mono rounded-md px-3 py-2 text-[11px] tracking-[0.1em] uppercase transition-colors disabled:opacity-50 ${
                      inputSource === id
                        ? 'bg-accent/[0.12] text-accent'
                        : 'text-dim hover:text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {liveMode ? (
              <LivePrPanel
                value={prUrl}
                examples={prExamples}
                running={running}
                error={notice}
                onChange={(next) => {
                  setPrUrl(next);
                  setActiveDemo(null);
                }}
                onReview={reviewPr}
              />
            ) : (
              <InputPanel
                label={mode.inputLabel}
                placeholder={mode.placeholder}
                value={input}
                samples={mode.samples}
                running={running}
                onChange={(next) => {
                  setInput(next);
                  setActiveDemo(null);
                }}
                onAnalyze={() => void analyze(modeId, input)}
                onLoadSample={(sample) => {
                  setInput(sample.text);
                  setActiveDemo(null);
                  clearResults();
                }}
                onReset={() => {
                  setInput('');
                  setActiveDemo(null);
                  clearResults();
                }}
              />
            )}

            {pullRequest ? <PrSummaryCard pr={pullRequest} /> : null}

            <PipelineRail
              descriptors={descriptors}
              stages={stages}
              totalMs={analysis?.timings?.totalMs}
            />
          </div>

          <div className="flex flex-col gap-6">
            {started ? <DecisionFlow nodes={flowNodes} meta={meta} /> : null}

            {!decision ? (
              <Panel className="flex min-h-[460px] flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="mono border-line text-dim rounded-md border px-2 py-1 text-[10px] tracking-[0.18em] uppercase">
                  {running ? 'analyzing' : 'awaiting input'}
                </span>
                <p className="max-w-sm text-sm text-dim">
                  {running
                    ? (activeStage?.label ?? 'Working…')
                    : 'Pick a demo scenario above, or paste your own input, to see the decision cockpit.'}
                </p>
                {running ? (
                  <div className="bg-line relative mt-2 h-0.5 w-48 overflow-hidden rounded-full">
                    <span className="bg-accent absolute inset-y-0 left-0 w-1/3 animate-[var(--animate-sweep)]" />
                  </div>
                ) : null}
              </Panel>
            ) : (
              <>
                {analysis?.divergence ? (
                  <ConflictBanner
                    divergence={analysis.divergence}
                    decision={decision}
                    onOpenTrace={() => setTraceOpen(true)}
                  />
                ) : null}

                <DecisionCard
                  decision={decision}
                  meta={meta}
                  confidence={analysis?.decisionConfidence ?? 0}
                  extractionConfidence={analysis?.extractionConfidence ?? 0}
                  onOpenTrace={() => setTraceOpen(true)}
                />

                {analysis?.divergence ? (
                  <DivergencePanel
                    llm={analysis.llm}
                    divergence={analysis.divergence}
                    decision={decision}
                  />
                ) : null}

                {analysis?.explanation ? (
                  <ExplanationPanel
                    explanation={analysis.explanation}
                    model={meta?.source === 'live' ? meta.model : 'deterministic template'}
                  />
                ) : null}

                <TracePanel
                  trace={analysis?.trace ?? []}
                  rulesEvaluated={decision.rulesEvaluated}
                  veto={decision.veto}
                />

                {analysis && analysis.actions.length > 0 ? (
                  <ActionsPanel
                    actions={analysis.actions}
                    requiredActions={decision.requiredActions}
                  />
                ) : null}

                <FactsPanel
                  facts={analysis?.facts ?? []}
                  unknowns={analysis?.unknowns ?? []}
                  validation={analysis?.validation ?? null}
                />
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-line mx-auto max-w-[1500px] border-t px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="mono text-[10px] tracking-[0.12em] text-dim uppercase">
            {mode.policyId} v{mode.policyVersion} · {mode.ruleCount} rules · decisions are computed,
            not generated
          </p>
          <p className="text-[12px] text-dim">
            Built by{' '}
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-accent transition-colors"
            >
              Nishant Ranjan
            </a>{' '}
            ·{' '}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-accent transition-colors"
            >
              Source on GitHub
            </a>{' '}
            · Apache-2.0
          </p>
        </div>
      </footer>

      {decision && analysis?.divergence ? (
        <DecisionTraceDrawer
          open={traceOpen}
          onClose={() => setTraceOpen(false)}
          meta={meta}
          facts={analysis.facts}
          validation={analysis.validation}
          llm={analysis.llm}
          decision={decision}
          trace={analysis.trace}
          divergence={analysis.divergence}
          actions={analysis.actions}
        />
      ) : null}
    </div>
  );
}
