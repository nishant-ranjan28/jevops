import { z } from 'zod';
import type { JevEvaluation, JevRule } from './engine';
import type { Veto } from '../types';

type Scalar = string | number | boolean | null;
type Operand = Scalar | { threshold: string };
const thresholdRefSchema = z.strictObject({ threshold: z.string().min(1) });
type Predicate =
  | { fact: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: Operand; projection?: 'length' }
  | { all: Predicate[] }
  | { any: Predicate[] };
const predicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({
    fact: z.string().min(1), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    value: z.union([z.string(), z.number().finite(), z.boolean(), z.null(), thresholdRefSchema]),
    projection: z.literal('length').optional(),
  }),
  z.strictObject({ all: z.array(predicateSchema).min(1) }),
  z.strictObject({ any: z.array(predicateSchema).min(1) }),
]));
const vetoFields = {
  ruleId: z.string().min(1), label: z.string().min(1), threshold: z.string().min(1),
};
const vetoSchema = z.union([
  z.strictObject({ ...vetoFields, flag: z.string().min(1) }),
  z.strictObject({ ...vetoFields, minScore: z.union([z.number().min(0).max(100), thresholdRefSchema]) }),
]);
type DataVeto =
  | { ruleId: string; label: string; threshold: string; flag: string }
  | { ruleId: string; label: string; threshold: string; minScore: number };
const policySchema = z.strictObject({
  id: z.string().min(1), version: z.string().min(1), title: z.string().min(1),
  thresholds: z.record(z.string(), z.number().finite()),
  rules: z.array(z.strictObject({
    id: z.string().min(1), label: z.string().min(1),
    category: z.enum(['blast-radius', 'coverage', 'security', 'operational', 'impact', 'reliability', 'process']),
    weight: z.number().finite().optional(), flags: z.array(z.string()).optional(),
    when: predicateSchema,
  })).min(1),
  vetoes: z.array(vetoSchema),
});

/** Compile validated data once during module initialization, never during a run. */
export function loadPolicyData<F extends object, Flag extends string>(input: unknown, contract: {
  facts: z.ZodObject;
  flags: readonly Flag[];
  thresholds: z.ZodType<Record<string, number>>;
}) {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid policy data: ${parsed.error.message}`);
  const data = parsed.data;
  const fail = (message: string): never => { throw new Error(`Invalid policy ${data.id}: ${message}`); };
  const thresholds = contract.thresholds.safeParse(data.thresholds);
  if (!thresholds.success) fail(`thresholds: ${thresholds.error.message}`);
  const resolveOperand = (value: Operand): Scalar => {
    if (value !== null && typeof value === 'object') {
      if (!Object.hasOwn(data.thresholds, value.threshold)) fail(`unknown threshold ${value.threshold}`);
      return data.thresholds[value.threshold];
    }
    return value;
  };
  const format = (text: string, allowScore = false): string => text.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    if (allowScore && key === 'score') return '{score}';
    if (!Object.hasOwn(data.thresholds, key)) fail(`unknown threshold placeholder ${key}`);
    return String(data.thresholds[key]);
  });
  const flagSet = new Set<string>(contract.flags);
  const ids = new Set<string>();
  for (const rule of data.rules) {
    if (ids.has(rule.id)) fail(`duplicate rule ID ${rule.id}`);
    ids.add(rule.id);
    for (const flag of rule.flags ?? []) if (!flagSet.has(flag)) fail(`${rule.id}: unknown flag ${flag}`);
  }
  for (const veto of data.vetoes) {
    if ('flag' in veto && !flagSet.has(veto.flag)) fail(`unknown veto flag ${veto.flag}`);
    if ('flag' in veto && !data.rules.some(r => r.id === veto.ruleId && r.flags?.includes(veto.flag))) {
      fail(`veto ${veto.ruleId} must reference a rule raising ${veto.flag}`);
    }
  }
  const vetoes: DataVeto[] = data.vetoes.map(veto => {
    const common = { ruleId: veto.ruleId, label: format(veto.label, true), threshold: format(veto.threshold, true) };
    if ('flag' in veto) return { ...common, flag: veto.flag };
    const minScore = resolveOperand(veto.minScore);
    if (typeof minScore !== 'number' || minScore < 0 || minScore > 100) fail(`invalid veto score ${minScore}`);
    return { ...common, minScore: minScore as number };
  });
  const compile = (predicate: Predicate, ruleId: string): ((facts: F) => boolean) => {
    if ('all' in predicate) {
      const children = predicate.all.map(p => compile(p, ruleId));
      return facts => children.every(test => test(facts));
    }
    if ('any' in predicate) {
      const children = predicate.any.map(p => compile(p, ruleId));
      return facts => children.some(test => test(facts));
    }
    const operand = resolveOperand(predicate.value);
    if (!Object.hasOwn(contract.facts.shape, predicate.fact)) fail(`${ruleId}: unknown fact ${predicate.fact}`);
    const schema = contract.facts.shape[predicate.fact] as z.ZodType;
    if (predicate.projection === 'length') {
      if (!(schema instanceof z.ZodArray)) fail(`${ruleId}: length requires an array fact`);
      if (typeof operand !== 'number' || !Number.isInteger(operand) || (operand as number) < 0) {
        fail(`${ruleId}: length requires a nonnegative integer operand`);
      }
    } else if (!schema.safeParse(operand).success) {
      fail(`${ruleId}: invalid operand for ${predicate.fact}`);
    }
    const numeric = predicate.op !== 'eq' && predicate.op !== 'ne';
    if (numeric && typeof operand !== 'number') fail(`${ruleId}: ordered comparisons require numbers`);
    return facts => {
      const raw = (facts as Record<string, unknown>)[predicate.fact];
      const value = predicate.projection === 'length' ? (Array.isArray(raw) ? raw.length : null) : raw;
      switch (predicate.op) {
        case 'eq': return value === operand;
        case 'ne': return value !== operand;
        // Missing numeric signals never match a threshold.
        case 'gt': return typeof value === 'number' && value > (operand as number);
        case 'gte': return typeof value === 'number' && value >= (operand as number);
        case 'lt': return typeof value === 'number' && value < (operand as number);
        case 'lte': return typeof value === 'number' && value <= (operand as number);
      }
    };
  };
  const rules: JevRule<F, Flag>[] = data.rules.map(rule => ({
    ...rule, label: format(rule.label), flags: rule.flags as Flag[] | undefined, when: compile(rule.when, rule.id),
  }));
  return { ...data, thresholds: thresholds.data!, rules, vetoes };
}

/** Vetoes are checked in declared order; only the score placeholder is expanded. */
export function policyVeto<Flag extends string>(vetoes: readonly DataVeto[], ev: JevEvaluation<Flag>): Veto | null {
  const veto = vetoes.find(v => 'flag' in v ? ev.flags.includes(v.flag as Flag) : ev.score >= v.minScore);
  if (!veto) return null;
  return {
    ruleId: veto.ruleId,
    label: veto.label.replaceAll('{score}', String(ev.score)),
    threshold: veto.threshold.replaceAll('{score}', String(ev.score)),
  };
}
