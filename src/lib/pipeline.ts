import { z } from 'zod';
import { decisionConfidence } from './jev/engine';
import { mergeValidation, parseFields, type ValidationReport } from './jev/parse';
import { computeDivergence } from './divergence';
import { mockExplain } from './explain';
import { fetchPullRequest, GitHubError } from './github/client';
import { buildPullRequestPrompt, toSummary } from './github/summarize';
import { parsePullRequestUrl } from './github/url';
import { extractJsonObject } from './llm/json';
import { mockExtract } from './llm/mock';
import { resolveProviderChain, type LlmProvider } from './llm/provider';
import { MODES } from './modes';
import { buildExplanationPrompt, buildExtractionPrompt, EXPLANATION_SYSTEM, EXTRACTION_SYSTEM } from './prompts';
import {
  stagesFor,
  type AnalysisEvent,
  type AnalysisMeta,
  type AnalysisResult,
  type LlmRecommendation,
  type ModeId,
  type ProviderAttempt,
  type PullRequestSummary,
  type StageId,
} from './types';

/* --------------------------------------------------------- envelope schema */

const recommendationSchema = z.object({
  stance: z.enum(['PROCEED', 'PROCEED_WITH_GUARDRAILS', 'HOLD', 'BLOCK']),
  headline: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

const envelopeSchema = z.object({
  facts: z.record(z.string(), z.unknown()),
  recommendation: recommendationSchema,
  extractionConfidence: z.number().min(0).max(1),
});

const NEUTRAL_RECOMMENDATION: LlmRecommendation = {
  stance: 'PROCEED_WITH_GUARDRAILS',
  headline: 'No recommendation returned',
  rationale: 'The model did not return a usable recommendation for this input.',
  confidence: 0.5,
};

const ENVELOPE_DEFAULTS: z.infer<typeof envelopeSchema> = {
  facts: {},
  recommendation: NEUTRAL_RECOMMENDATION,
  extractionConfidence: 0.6,
};

interface Extraction {
  raw: Record<string, unknown>;
  llm: LlmRecommendation;
  extractionConfidence: number;
  validation: ValidationReport;
}

/* ----------------------------------------------------------------- helpers */

const ALL_STAGES = [...stagesFor(false), ...stagesFor(true)];
const stageLabel = (id: StageId) => ALL_STAGES.find((s) => s.id === id)?.label ?? id;
const since = (start: number) => Math.round(performance.now() - start);
const fmtMs = (ms: number) => (ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`);

function summariseValidation(validation: ValidationReport): string {
  if (validation.shapeRejected) return 'payload rejected — every field defaulted';
  const base = `${validation.fieldsAccepted}/${validation.fieldsTotal} fields accepted`;
  return validation.repairs.length === 0
    ? `${base} · no repairs`
    : `${base} · ${validation.repairs.length} repaired`;
}

/**
 * Live model output goes through the same schema gate as everything else.
 * Whatever the model returns, only validated, typed facts reach Jev.
 */
async function extractWithProvider(
  provider: LlmProvider,
  mode: ModeId,
  input: string,
  signal?: AbortSignal,
  correction?: string,
  useJsonMode = true,
): Promise<Extraction> {
  const definition = MODES[mode];
  const messages = [
    { role: 'system' as const, content: EXTRACTION_SYSTEM },
    { role: 'user' as const, content: buildExtractionPrompt(definition, input) },
  ];
  if (correction) messages.push({ role: 'user' as const, content: correction });

  const content = await provider.complete({
    messages,
    json: useJsonMode,
    temperature: 0,
    signal,
  });

  const { value, validation } = parseFields(envelopeSchema, ENVELOPE_DEFAULTS, extractJsonObject(content));
  return {
    raw: value.facts,
    llm: value.recommendation,
    extractionConfidence: value.extractionConfidence,
    validation,
  };
}

function extractWithMock(mode: ModeId, input: string): Extraction {
  const m = mockExtract(mode, input);
  const { value, validation } = parseFields(envelopeSchema, ENVELOPE_DEFAULTS, {
    facts: m.raw,
    recommendation: m.llm,
    extractionConfidence: m.extractionConfidence,
  });
  return {
    raw: value.facts,
    llm: value.recommendation,
    extractionConfidence: value.extractionConfidence,
    validation,
  };
}

export interface AnalyzeOptions {
  mode: ModeId;
  /** Pasted text. Ignored when prUrl is supplied — the PR becomes the input. */
  input: string;
  /** When present, the input is fetched from GitHub instead of pasted. */
  prUrl?: string;
  providerOverride?: string;
  /** Pick a specific model for this run only. */
  modelOverride?: string;
  signal?: AbortSignal;
}

/** Tells the model exactly which fields it got wrong, for the single retry. */
function buildCorrection(validation: ValidationReport): string {
  const fields = validation.repairs
    .map((r) => `- ${r.field}: received ${r.received} (${r.reason})`)
    .join('\n');
  return `Your previous response failed schema validation and was rejected.

${validation.shapeRejected ? 'The payload was not a JSON object.' : `These fields were invalid:\n${fields}`}

Return the same analysis again as one JSON object, with every field matching the declared type and enum exactly. Do not invent values to fill gaps — use the documented default and name the field in "unknowns".`;
}

/**
 * The pipeline, in order, with no shortcuts:
 *   input -> LLM facts -> schema -> Jev policy -> deterministic actions -> LLM explanation
 * The model is never consulted about the decision itself.
 */
export async function* runAnalysis(options: AnalyzeOptions): AsyncGenerator<AnalysisEvent> {
  const { mode, prUrl, providerOverride, modelOverride, signal } = options;
  const definition = MODES[mode];
  const started = performance.now();
  const live = typeof prUrl === 'string' && prUrl.trim().length > 0;

  let input = options.input;
  let pullRequest: PullRequestSummary | null = null;
  let fetchMs: number | undefined;

  const { chain } = resolveProviderChain(providerOverride, modelOverride);
  const head = chain[0];
  /** The provider that actually served this run. Set by the failover loop. */
  let activeProvider: LlmProvider = head.provider;
  /** Every provider turn, in order — the failover story, as data. */
  const attempts: ProviderAttempt[] = [];
  let meta: AnalysisMeta = {
    provider: head.provider.id,
    model: head.provider.model,
    source: head.provider.isMock ? 'mock' : 'live',
    reason: head.reason,
    servedBy: head.provider.id,
    attempts,
  };
  yield { type: 'meta', meta };

  /* -------------------------------------------------------- input / fetch */
  if (live) {
    yield { type: 'stage', stage: 'fetch', status: 'start', label: stageLabel('fetch') };
    const fetchStart = performance.now();

    const parsed = parsePullRequestUrl(prUrl);
    if (!parsed.ok) {
      yield {
        type: 'stage',
        stage: 'fetch',
        status: 'failed',
        label: stageLabel('fetch'),
        detail: parsed.reason,
      };
      yield { type: 'error', message: parsed.reason };
      return;
    }

    try {
      const context = await fetchPullRequest(parsed.ref, signal);
      pullRequest = toSummary(context);
      input = buildPullRequestPrompt(context);
      fetchMs = since(fetchStart);

      yield { type: 'pull-request', pullRequest, prompt: input };
      yield {
        type: 'stage',
        stage: 'fetch',
        status: 'done',
        label: stageLabel('fetch'),
        detail: `${pullRequest.repo}#${pullRequest.number} · ${pullRequest.changedFiles} files · +${pullRequest.additions}/-${pullRequest.deletions} · ${fmtMs(fetchMs)}`,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      const message =
        error instanceof GitHubError
          ? error.userMessage
          : `Failed to fetch the pull request: ${(error as Error).message}`;
      yield {
        type: 'stage',
        stage: 'fetch',
        status: 'failed',
        label: stageLabel('fetch'),
        detail: message,
      };
      yield { type: 'error', message };
      return;
    }
  } else {
    yield { type: 'stage', stage: 'input', status: 'start', label: stageLabel('input') };
    yield {
      type: 'stage',
      stage: 'input',
      status: 'done',
      label: stageLabel('input'),
      detail: `${input.length.toLocaleString()} characters · ${definition.label}`,
    };
  }

  /* -------------------------------------------------------------- analyze */
  yield {
    type: 'stage',
    stage: 'analyze',
    status: 'start',
    label: stageLabel('analyze'),
    detail: meta.source === 'live' ? `${meta.provider} · ${meta.model}` : 'deterministic mock',
  };
  const analyzeStart = performance.now();

  let extraction: Extraction | null = null;
  let extractionAttempts = 1;
  const failovers: string[] = [];

  // Walk the provider chain. The first one that answers wins; the rest are
  // cover. The chain always ends with the mock, so this loop always exits
  // with an extraction.
  for (const candidate of chain) {
    const { provider } = candidate;

    if (provider.isMock) {
      extraction = extractWithMock(mode, input);
      activeProvider = provider;
      attempts.push({ provider: provider.id, status: 'ok' });
      meta = failovers.length
        ? {
            provider: `${failovers.join(' → ')} → mock fallback`,
            model: 'jevops-deterministic-mock',
            source: 'mock',
            reason: candidate.reason,
            servedBy: provider.id,
            attempts,
          }
        : {
            provider: provider.id,
            model: provider.model,
            source: 'mock',
            reason: candidate.reason,
            servedBy: provider.id,
            attempts,
          };
      if (failovers.length) yield { type: 'meta', meta };
      break;
    }

    try {
      let attempt: Extraction;
      try {
        attempt = await extractWithProvider(provider, mode, input, signal);
      } catch (jsonModeError) {
        if ((jsonModeError as Error).name === 'AbortError') throw jsonModeError;
        // Some providers enforce JSON mode server-side and reject long or
        // diff-heavy prompts outright. Our extractor recovers JSON from prose,
        // so a plain-mode attempt is worth trying before writing the provider
        // off and failing over.
        attempt = await extractWithProvider(provider, mode, input, signal, undefined, false);
      }
      extractionAttempts = 1;

      // One corrective retry when the model's output did not satisfy the
      // schema. Whichever attempt validated more cleanly is the one we keep.
      const firstRun = definition.run(attempt.raw);
      const firstValidation = mergeValidation(attempt.validation, firstRun.validation, 'facts');
      if (!firstValidation.ok) {
        extractionAttempts = 2;
        try {
          const retried = await extractWithProvider(
            provider,
            mode,
            input,
            signal,
            buildCorrection(firstValidation),
          );
          const retryRun = definition.run(retried.raw);
          const retryValidation = mergeValidation(retried.validation, retryRun.validation, 'facts');
          if (retryValidation.repairs.length < firstValidation.repairs.length) {
            attempt = retried;
          }
        } catch {
          // The retry is best-effort; the first attempt already has defaults
          // filled in for every rejected field.
        }
      }

      extraction = attempt;
      activeProvider = provider;
      attempts.push({ provider: provider.id, status: 'ok' });
      meta = {
        provider: failovers.length ? `${provider.id} (after ${failovers.join(', ')})` : provider.id,
        model: provider.model,
        source: 'live',
        reason: failovers.length
          ? `${failovers.join(' and ')} unavailable — served by ${provider.id}.`
          : candidate.reason,
        servedBy: provider.id,
        attempts,
      };
      if (failovers.length) yield { type: 'meta', meta };
      break;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      failovers.push(provider.id);
      attempts.push({ provider: provider.id, status: 'failed', error: message });
      yield { type: 'error', message: `${provider.id} extraction failed: ${message}` };
    }
  }

  if (!extraction) {
    // Unreachable: the chain always terminates in the mock.
    extraction = extractWithMock(mode, input);
  }

  const analyzeMs = since(analyzeStart);
  yield {
    type: 'stage',
    stage: 'analyze',
    status: 'done',
    label: stageLabel('analyze'),
    detail:
      meta.source === 'live'
        ? `live · ${meta.model} · ${fmtMs(analyzeMs)}${
            extractionAttempts > 1 ? ' · 1 schema retry' : ''
          }${failovers.length ? ` · failed over from ${failovers.join(', ')}` : ''}`
        : `mock · deterministic · ${fmtMs(analyzeMs)}${
            failovers.length ? ` · ${failovers.join(', ')} unavailable` : ''
          }`,
  };

  /* ---------------------------------------------------------------- facts */
  yield { type: 'stage', stage: 'facts', status: 'start', label: stageLabel('facts') };
  const run = definition.run(extraction.raw);
  const validation = mergeValidation(extraction.validation, run.validation, 'facts');

  yield {
    type: 'facts',
    facts: run.facts,
    unknowns: run.unknowns,
    validation,
    extractionConfidence: extraction.extractionConfidence,
    llm: extraction.llm,
  };
  yield {
    type: 'stage',
    stage: 'facts',
    status: 'done',
    label: stageLabel('facts'),
    detail: summariseValidation(validation),
  };

  /* --------------------------------------------------------------- decide */
  yield { type: 'stage', stage: 'decide', status: 'start', label: stageLabel('decide') };
  const divergence = computeDivergence(extraction.llm, run.decision, run.trace);
  const confidence = decisionConfidence({
    extractionConfidence: extraction.extractionConfidence,
    unknownCount: run.unknowns.length,
    // Counted from the fact rows, so a field left null without being flagged
    // still costs confidence.
    unresolvedCount: run.facts.filter((f) => !f.known).length,
    firedCount: run.trace.length,
  });

  yield {
    type: 'decision',
    decision: run.decision,
    trace: run.trace,
    divergence,
    decisionConfidence: confidence,
  };
  yield {
    type: 'stage',
    stage: 'decide',
    status: 'done',
    label: stageLabel('decide'),
    detail: `${run.decision.rulesEvaluated} rules evaluated · ${run.trace.length} fired · ${run.decision.headline}`,
  };

  /* ------------------------------------------------------------------ act */
  yield { type: 'stage', stage: 'act', status: 'start', label: stageLabel('act') };
  yield { type: 'actions', actions: run.actions };
  const executed = run.actions.filter((a) => a.status === 'executed').length;
  yield {
    type: 'stage',
    stage: 'act',
    status: 'done',
    label: stageLabel('act'),
    detail: `${run.actions.length} actions · ${executed} executed`,
  };

  /* -------------------------------------------------------------- explain */
  yield {
    type: 'stage',
    stage: 'explain',
    status: 'start',
    label: stageLabel('explain'),
    detail: meta.source === 'live' ? `${meta.provider} · ${meta.model}` : 'template',
  };
  const explainStart = performance.now();
  let explanation: string;

  if (meta.source === 'mock') {
    explanation = mockExplain({
      mode,
      decision: run.decision,
      trace: run.trace,
      llm: extraction.llm,
      divergence,
    });
  } else {
    try {
      explanation = (
        await activeProvider.complete({
          messages: [
            { role: 'system', content: EXPLANATION_SYSTEM },
            {
              role: 'user',
              content: buildExplanationPrompt({
                mode: definition,
                input,
                facts: run.rawFacts,
                decision: run.decision,
                trace: run.trace,
                llm: extraction.llm,
                divergence,
              }),
            },
          ],
          temperature: 0.3,
          maxTokens: 600,
          signal,
        })
      ).trim();
    } catch {
      explanation = mockExplain({
        mode,
        decision: run.decision,
        trace: run.trace,
        llm: extraction.llm,
        divergence,
      });
    }
  }
  const explainMs = since(explainStart);

  yield { type: 'explanation', explanation };
  yield {
    type: 'stage',
    stage: 'explain',
    status: 'done',
    label: stageLabel('explain'),
    detail: `${meta.source === 'live' ? 'live' : 'template'} · ${fmtMs(explainMs)}`,
  };

  const result: AnalysisResult = {
    mode,
    meta,
    input,
    pullRequest,
    extractionAttempts,
    facts: run.facts,
    rawFacts: run.rawFacts,
    unknowns: run.unknowns,
    validation,
    extractionConfidence: extraction.extractionConfidence,
    decisionConfidence: confidence,
    llm: extraction.llm,
    decision: run.decision,
    trace: run.trace,
    divergence,
    actions: run.actions,
    explanation,
    timings: {
      fetchMs,
      analyzeMs,
      validateMs: run.timings.validateMs,
      decideMs: run.timings.decideMs,
      actMs: run.timings.actMs,
      explainMs,
      totalMs: since(started),
    },
  };

  yield { type: 'result', result };
}
