import type { FiredRule } from './jev/engine';
import type { Divergence, JevDecision, LlmRecommendation, ModeId } from './types';

const MODE_SUBJECT: Record<ModeId, string> = {
  'pr-risk': 'this pull request',
  'bug-triage': 'this report',
  'deploy-gate': 'this rollout',
};

/**
 * Template explanation used in mock mode. It reads the same trace the real
 * model would read, so the shape of the output is honest even offline.
 */
export function mockExplain(args: {
  mode: ModeId;
  decision: JevDecision;
  trace: FiredRule<string>[];
  llm: LlmRecommendation;
  divergence: Divergence;
}): string {
  const { mode, decision, trace, llm, divergence } = args;
  const subject = MODE_SUBJECT[mode];
  const top = trace.filter((r) => r.weight > 0).slice(0, 3);
  const mitigations = trace.filter((r) => r.weight < 0);

  const p1 =
    `Jev returned ${decision.headline} for ${subject} at severity ${decision.severityLabel}, ` +
    `with ${decision.scoreLabel.toLowerCase()} ${decision.score}/100. That verdict comes from ${decision.policyId} v${decision.policyVersion}, ` +
    `evaluated against the extracted facts rather than against the tone of the write-up.`;

  const vetoLine = decision.veto
    ? ` ${decision.veto.ruleId} is a hard veto: ${decision.veto.threshold}, so it set the outcome on its own and the aggregate score did not get a say.`
    : '';

  const p2 = top.length
    ? `The weight came from ${top.length} condition${top.length === 1 ? '' : 's'}: ` +
      top.map((r) => `${r.id}, ${r.label.toLowerCase()} (+${r.weight})`).join('; ') +
      `.${mitigations.length ? ` ${mitigations.length} mitigating rule${mitigations.length === 1 ? '' : 's'} pulled the score back down, but not far enough to change the outcome.` : ''}${vetoLine}`
    : `No positive-weight rule fired. The facts as extracted do not meet any escalation condition in the policy, which is why ${subject} clears without extra gates.${vetoLine}`;

  const p3 = divergence.agree
    ? `The model's own read (${llm.stance.replaceAll('_', ' ').toLowerCase()}) matched the policy, so there is nothing to reconcile. Next: ${decision.requiredActions[0].toLowerCase()}.`
    : `${divergence.summary} The policy holds because it compares facts to fixed thresholds, while the narrative read is only as good as how the situation was described. Next: ${decision.requiredActions[0].toLowerCase()}.`;

  return [p1, p2, p3].join('\n\n');
}
