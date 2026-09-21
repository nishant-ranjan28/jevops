/**
 * Jev — the deterministic decision layer.
 *
 * The LLM never decides anything here. It only produces facts.
 * Jev turns facts into typed decisions via explicit, ordered, inspectable rules.
 *
 * Contract:
 *   facts -> evaluate(rules) -> { score, flags, fired[] } -> derive() -> typed decision
 *
 * Every rule that fires is recorded, so any decision can be traced back to the
 * exact policy lines that produced it.
 */

export type RuleCategory =
  | 'blast-radius'
  | 'coverage'
  | 'security'
  | 'operational'
  | 'impact'
  | 'reliability'
  | 'process';

export interface JevRule<F, Flag extends string> {
  /** Stable identifier, shown in the decision trace. */
  readonly id: string;
  /** Human sentence describing what the rule detected. */
  readonly label: string;
  readonly category: RuleCategory;
  /** Contribution to the raw score when the rule fires. Can be negative. */
  readonly weight?: number;
  /** Flags raised when the rule fires. Flags drive the typed derivation. */
  readonly flags?: readonly Flag[];
  readonly when: (facts: F) => boolean;
}

export interface FiredRule<Flag extends string> {
  id: string;
  label: string;
  category: RuleCategory;
  weight: number;
  flags: Flag[];
}

export interface JevEvaluation<Flag extends string> {
  /** Raw sum of weights, unclamped. */
  rawScore: number;
  /** Raw score clamped to 0..100. */
  score: number;
  flags: Flag[];
  fired: FiredRule<Flag>[];
  rulesEvaluated: number;
}

export interface JevPolicy<F, Flag extends string, D> {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly rules: readonly JevRule<F, Flag>[];
  readonly derive: (facts: F, evaluation: JevEvaluation<Flag>) => D;
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function evaluate<F, Flag extends string>(
  rules: readonly JevRule<F, Flag>[],
  facts: F,
): JevEvaluation<Flag> {
  const fired: FiredRule<Flag>[] = [];
  const flags = new Set<Flag>();
  let rawScore = 0;

  for (const rule of rules) {
    let matched = false;
    try {
      matched = rule.when(facts);
    } catch {
      // A malformed fact must never crash the decision layer.
      matched = false;
    }
    if (!matched) continue;

    const weight = rule.weight ?? 0;
    rawScore += weight;
    const ruleFlags = [...(rule.flags ?? [])];
    for (const f of ruleFlags) flags.add(f);

    fired.push({
      id: rule.id,
      label: rule.label,
      category: rule.category,
      weight,
      flags: ruleFlags,
    });
  }

  return {
    rawScore,
    score: Math.round(clamp(rawScore)),
    flags: [...flags],
    fired: fired.sort((a, b) => b.weight - a.weight),
    rulesEvaluated: rules.length,
  };
}

/** Typed flag lookup used inside `derive`. */
export function has<Flag extends string>(
  evaluation: JevEvaluation<Flag>,
  flag: Flag,
): boolean {
  return evaluation.flags.includes(flag);
}

export function anyOf<Flag extends string>(
  evaluation: JevEvaluation<Flag>,
  ...candidates: Flag[]
): boolean {
  return candidates.some((c) => evaluation.flags.includes(c));
}

/**
 * Jev's own confidence. Deliberately NOT the model's confidence:
 * it degrades when the extraction left fields undetermined, because a
 * deterministic rule fired on a guess is worth less than one fired on a fact.
 *
 * Two independent measures of the same gap are considered:
 *   - `unknownCount`    — fields the model explicitly flagged as undetermined
 *   - `unresolvedCount` — fact rows that carry no value, flagged or not
 *
 * The larger wins. A model that quietly returns `null` instead of admitting
 * the gap must not earn a higher confidence than one that says so plainly.
 */
export function decisionConfidence(opts: {
  extractionConfidence: number;
  unknownCount: number;
  unresolvedCount?: number;
  firedCount: number;
}): number {
  const { extractionConfidence, unknownCount, unresolvedCount = 0, firedCount } = opts;
  const missingCount = Math.max(unknownCount, unresolvedCount);
  const missingPenalty = Math.min(0.35, missingCount * 0.07);
  const evidenceBonus = Math.min(0.12, firedCount * 0.02);
  const base = clamp(extractionConfidence, 0, 1);
  return Number(clamp(base - missingPenalty + evidenceBonus, 0.05, 0.99).toFixed(2));
}
