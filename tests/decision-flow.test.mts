/**
 * The pipeline visualisation must be a readout of the run, never decoration.
 * These tests pin that: no node may report progress that did not happen.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFlowNodes, type FlowNode } from '../src/lib/flow';
import type { AnalysisMeta, FactRow, JevDecision, StageId, StageView } from '../src/lib/types';

const NO_STAGES = (): Record<StageId, StageView> =>
  ({
    input: { status: 'pending' },
    fetch: { status: 'pending' },
    analyze: { status: 'pending' },
    facts: { status: 'pending' },
    decide: { status: 'pending' },
    act: { status: 'pending' },
    explain: { status: 'pending' },
  }) as Record<StageId, StageView>;

const meta = (over: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  source: 'live',
  reason: 'Using OpenRouter.',
  servedBy: 'openrouter',
  attempts: [{ provider: 'openrouter', status: 'ok' }],
  ...over,
});

const decision = (over: Partial<JevDecision> = {}): JevDecision => ({
  stance: 'PROCEED',
  headline: 'SHIP',
  score: 5,
  scoreLabel: 'Risk score',
  severityLabel: 'LOW',
  fields: [],
  requiredActions: [],
  veto: null,
  policyId: 'jev.pr-risk',
  policyVersion: '1.2.0',
  rulesEvaluated: 24,
  ...over,
});

const fact = (known: boolean): FactRow => ({ key: 'k', label: 'l', value: 'v', known });

const base = {
  live: true,
  stages: NO_STAGES(),
  meta: null,
  pullRequest: null,
  facts: [],
  unknowns: [],
  validation: null,
  decision: null,
  trace: [],
  actions: [],
  explanation: '',
  extractionAttempts: 1,
};

const byId = (nodes: FlowNode[], id: string) => {
  const node = nodes.find((n) => n.id === id);
  assert.ok(node, `expected a node called ${id}`);
  return node;
};

test('renders the eight architecture stages in order', () => {
  const ids = buildFlowNodes(base).map((n) => n.id);
  assert.deepEqual(ids, [
    'source',
    'llm',
    'facts',
    'schema',
    'rules',
    'decision',
    'actions',
    'explanation',
  ]);
});

test('before a run every stage is pending — nothing claims work it did not do', () => {
  const nodes = buildFlowNodes(base);
  assert.ok(
    nodes.every((n) => n.status === 'pending'),
    `expected all pending, got ${nodes.map((n) => `${n.id}:${n.status}`).join(', ')}`,
  );
});

test('a stage in flight reports active, and later stages stay pending', () => {
  const stages = NO_STAGES();
  stages.analyze = { status: 'start' };
  const nodes = buildFlowNodes({ ...base, stages, meta: meta() });

  assert.equal(byId(nodes, 'llm').status, 'active');
  assert.equal(byId(nodes, 'rules').status, 'pending');
  assert.equal(byId(nodes, 'decision').status, 'pending');
});

test('lanes separate probabilistic work from deterministic work', () => {
  const nodes = buildFlowNodes(base);
  assert.equal(byId(nodes, 'llm').lane, 'llm');
  assert.equal(byId(nodes, 'facts').lane, 'llm');
  assert.equal(byId(nodes, 'explanation').lane, 'llm');
  assert.equal(byId(nodes, 'schema').lane, 'jev');
  assert.equal(byId(nodes, 'rules').lane, 'jev');
  assert.equal(byId(nodes, 'actions').lane, 'jev');
  assert.equal(byId(nodes, 'decision').lane, 'decision');
  assert.equal(byId(nodes, 'decision').emphasis, true);
});

test('each completed stage reports its own real measurement', () => {
  const stages = NO_STAGES();
  for (const id of Object.keys(stages) as StageId[]) stages[id] = { status: 'done' };

  const nodes = buildFlowNodes({
    ...base,
    stages,
    meta: meta(),
    pullRequest: {
      url: 'https://github.com/axios/axios/pull/6539',
      repo: 'axios/axios',
      number: 6539,
      title: 't',
      author: 'a',
      baseBranch: 'v1.x',
      headBranch: 'h',
      changedFiles: 3,
      additions: 49,
      deletions: 4,
      state: 'merged',
      topFiles: [],
      filesTruncated: false,
    },
    facts: [fact(true), fact(true), fact(false)],
    unknowns: ['x'],
    validation: {
      ok: false,
      fieldsTotal: 24,
      fieldsAccepted: 23,
      repairs: [{ field: 'f', received: 'bad', reason: 'r' }],
      shapeRejected: false,
    },
    decision: decision({ veto: { ruleId: 'PR-DATA-002', label: 'l', threshold: 't' } }),
    trace: [{ id: 'PR-TEST-003', label: 'l', category: 'coverage', weight: 5, flags: [] }],
    actions: [
      { id: 'a', title: 't', status: 'executed', detail: 'd' },
      { id: 'b', title: 't', status: 'skipped', detail: 'd' },
    ],
    explanation: 'because',
    extractionAttempts: 2,
  });

  assert.match(byId(nodes, 'source').detail, /axios\/axios#6539 · 3 files · \+49\/-4/);
  assert.equal(byId(nodes, 'llm').detail, 'LIVE · OpenRouter · openai/gpt-4o-mini');
  assert.match(byId(nodes, 'facts').detail, /2\/3 resolved · 1 unresolved · 1 flagged by model/);
  assert.match(byId(nodes, 'schema').detail, /23\/24 accepted · 1 repaired · 1 retry/);
  assert.match(byId(nodes, 'rules').detail, /24 evaluated · 1 fired/);
  assert.match(byId(nodes, 'decision').detail, /SHIP · 5\/100 · veto PR-DATA-002/);
  assert.match(byId(nodes, 'actions').detail, /1\/2 executed/);
  assert.match(byId(nodes, 'explanation').detail, /live · informational only/);
});

test('unknown fields stay visible rather than being smoothed away', () => {
  const nodes = buildFlowNodes({ ...base, facts: [fact(true)], unknowns: ['a', 'b', 'c'] });
  assert.match(byId(nodes, 'facts').detail, /3 flagged by model/);
});

test('an unresolved fact is counted even when the model did not flag it', () => {
  // Exactly the axios case: isRollbackSafe came back null, unflagged.
  const nodes = buildFlowNodes({
    ...base,
    facts: [fact(true), fact(true), fact(false)],
    unknowns: [],
  });
  const detail = byId(nodes, 'facts').detail;
  assert.match(detail, /2\/3 resolved · 1 unresolved/);
  assert.ok(!/flagged by model/.test(detail), 'nothing was flagged, so nothing is claimed');
});

test('a fully resolved extraction makes no claim about missing fields', () => {
  const nodes = buildFlowNodes({ ...base, facts: [fact(true), fact(true)], unknowns: [] });
  assert.equal(byId(nodes, 'facts').detail, '2/2 resolved');
});

test('provider labels render for every provider', () => {
  for (const [id, label] of [
    ['openrouter', 'OpenRouter'],
    ['groq', 'Groq'],
    ['mock', 'Mock'],
  ] as [string, string][]) {
    const nodes = buildFlowNodes({
      ...base,
      meta: meta({ servedBy: id, model: 'm', source: id === 'mock' ? 'mock' : 'live' }),
    });
    const detail = byId(nodes, 'llm').detail;
    assert.match(detail, new RegExp(`· ${label} ·`));
    assert.match(detail, id === 'mock' ? /^MOCK/ : /^LIVE/);
  }
});

test('a run served after a failover still reports the provider that answered', () => {
  const nodes = buildFlowNodes({
    ...base,
    facts: [fact(true)],
    meta: meta({
      servedBy: 'groq',
      model: 'openai/gpt-oss-120b',
      provider: 'groq (after openrouter)',
      attempts: [
        { provider: 'openrouter', status: 'failed', error: '400' },
        { provider: 'groq', status: 'ok' },
      ],
    }),
  });

  assert.equal(byId(nodes, 'llm').detail, 'LIVE · Groq · openai/gpt-oss-120b');
  assert.equal(byId(nodes, 'llm').status, 'done', 'a recovered run is not a failed run');
});

test('the LLM node reports failed only when every live provider failed', () => {
  const nodes = buildFlowNodes({
    ...base,
    facts: [fact(true)],
    meta: meta({
      source: 'mock',
      servedBy: 'mock',
      model: 'jevops-deterministic-mock',
      attempts: [
        { provider: 'openrouter', status: 'failed', error: '400' },
        { provider: 'groq', status: 'failed', error: '404' },
        { provider: 'mock', status: 'ok' },
      ],
    }),
  });
  assert.equal(byId(nodes, 'llm').status, 'failed');
});

test('a pasted run labels its source as input, not a GitHub PR', () => {
  const stages = NO_STAGES();
  stages.input = { status: 'done', detail: '161 characters · Deployment Gate' };
  const nodes = buildFlowNodes({ ...base, live: false, stages });

  assert.equal(byId(nodes, 'source').label, 'Input');
  assert.match(byId(nodes, 'source').detail, /161 characters/);
});

test('a failed stage surfaces as failed, not silently skipped', () => {
  const stages = NO_STAGES();
  stages.fetch = { status: 'failed', detail: 'No such pull request.' };
  const nodes = buildFlowNodes({ ...base, stages });
  assert.equal(byId(nodes, 'source').status, 'failed');
});

test('a meta without an attempts list does not throw', () => {
  // Older payloads predate meta.attempts; the flow must degrade, not crash.
  const legacy = { ...meta(), attempts: undefined } as unknown as AnalysisMeta;
  const nodes = buildFlowNodes({ ...base, facts: [fact(true)], meta: legacy });
  assert.equal(byId(nodes, 'llm').status, 'done');
  assert.equal(byId(nodes, 'llm').detail, 'LIVE · OpenRouter · openai/gpt-4o-mini');
});

test('a mock run with no attempt history is not reported as a provider failure', () => {
  const nodes = buildFlowNodes({
    ...base,
    facts: [fact(true)],
    meta: meta({ source: 'mock', servedBy: 'mock', model: 'm', attempts: [] }),
  });
  assert.equal(byId(nodes, 'llm').status, 'done');
});
