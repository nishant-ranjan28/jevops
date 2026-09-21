import type { ModeDefinition } from './modes';
import type { AnalysisResult, JevDecision } from './types';
import type { FiredRule } from './jev/engine';

export const EXTRACTION_SYSTEM = `You are the extraction stage of JevOps, an engineering decision cockpit.

Your only job is to convert messy human engineering input into strict structured facts.

Hard rules:
- You do NOT make the decision. A deterministic policy engine called Jev does that, downstream of you.
- Never invent a value. If the input does not support a field, leave it at its null/false/"unknown" default AND name that field in "unknowns".
- Never round, smooth, or reinterpret numbers. Copy them exactly as written.
- Do not try to guess what the policy wants. Distorting facts to reach a nicer outcome is the single worst thing you can do here.
- Reply with one JSON object and nothing else. No prose, no code fences.`;

export function buildExtractionPrompt(mode: ModeDefinition, input: string): string {
  return `MODE: ${mode.label}
${mode.extractionGuidance}

Return exactly this JSON shape:
{
  "facts": ${mode.schemaHint},
  "recommendation": {
    "stance": "PROCEED" | "PROCEED_WITH_GUARDRAILS" | "HOLD" | "BLOCK",
    "headline": string,          // at most 6 words
    "rationale": string,         // 1-2 sentences, your own instinct
    "confidence": number         // 0..1
  },
  "extractionConfidence": number // 0..1, how well the input supported the fact set
}

About "recommendation": this is your own unaided instinct about what a human should do, formed from reading the text. It is recorded for comparison and is explicitly NOT binding. Do not try to predict the policy engine. Say what you actually think.

INPUT
-----
${input}`;
}

export const EXPLANATION_SYSTEM = `You are the explanation stage of JevOps.

A deterministic policy engine named Jev has already made the decision. You do not get to change it, soften it, or argue with it. You explain it to an engineer who has ten seconds.

Style:
- Direct, technical, calm. No hype, no filler, no apologies.
- Reference the specific rules and numbers that produced the outcome.
- If your earlier instinct disagreed with Jev, say plainly why the policy is the one that holds, and what it saw that a reading of the prose did not.
- 3 short paragraphs maximum. Plain text, no markdown headings, no bullet lists.`;

export function buildExplanationPrompt(args: {
  mode: ModeDefinition;
  input: string;
  facts: Record<string, unknown>;
  decision: JevDecision;
  trace: FiredRule<string>[];
  llm: AnalysisResult['llm'];
  divergence: AnalysisResult['divergence'];
}): string {
  const { mode, facts, decision, trace, llm, divergence } = args;
  const firedLines = trace
    .slice(0, 12)
    .map((r) => `- ${r.id} (${r.weight >= 0 ? '+' : ''}${r.weight}) ${r.label}`)
    .join('\n');

  return `MODE: ${mode.label}
POLICY: ${decision.policyId} v${decision.policyVersion}

EXTRACTED FACTS
${JSON.stringify(facts, null, 2)}

JEV DECISION
stance: ${decision.stance}
headline: ${decision.headline}
${decision.scoreLabel}: ${decision.score}/100
${decision.fields.map((f) => `${f.label}: ${f.value}`).join('\n')}

RULES THAT FIRED
${firedLines || '- none'}

REQUIRED ACTIONS
${decision.requiredActions.map((a) => `- ${a}`).join('\n')}

YOUR EARLIER INSTINCT
stance: ${llm.stance} — ${llm.headline}
${llm.rationale}

AGREEMENT: ${divergence.agree ? 'Your instinct matched Jev.' : `Your instinct did NOT match Jev. ${divergence.summary}`}

Explain the decision.`;
}
