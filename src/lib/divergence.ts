import type { FiredRule } from './jev/engine';
import { STANCE_RANK, type Divergence, type JevDecision, type LlmRecommendation } from './types';

const STANCE_WORDS: Record<string, string> = {
  PROCEED: 'proceed',
  PROCEED_WITH_GUARDRAILS: 'proceed with guardrails',
  HOLD: 'hold',
  BLOCK: 'block',
};

/**
 * The whole point of the product, in one function: compare what the model
 * felt about the prose with what the policy computed from the facts.
 */
export function computeDivergence(
  llm: LlmRecommendation,
  decision: JevDecision,
  trace: FiredRule<string>[],
): Divergence {
  const delta = STANCE_RANK[decision.stance] - STANCE_RANK[llm.stance];
  const agree = delta === 0;

  const drivers =
    delta > 0
      ? trace.filter((r) => r.weight > 0).slice(0, 3)
      : delta < 0
        ? trace.filter((r) => r.weight < 0).slice(0, 3)
        : trace.slice(0, 2);

  let summary: string;
  if (agree) {
    summary = `Model and policy both land on "${STANCE_WORDS[decision.stance]}". The decision is uncontested.`;
  } else if (delta > 0) {
    const names = drivers.map((d) => d.id).join(', ') || 'the aggregate score';
    summary = `The model wanted to ${STANCE_WORDS[llm.stance]}; Jev returned ${decision.stance.replaceAll('_', ' ')}. The policy is ${delta} step${delta === 1 ? '' : 's'} stricter because ${names} fired on facts the prose downplayed.`;
  } else {
    const names = drivers.map((d) => d.id).join(', ') || 'the mitigating conditions';
    summary = `The model was more cautious than the policy. Jev returned ${decision.stance.replaceAll('_', ' ')} because ${names} recorded mitigations the narrative did not credit.`;
  }

  return {
    agree,
    delta,
    llmStance: llm.stance,
    jevStance: decision.stance,
    drivers,
    summary,
  };
}
