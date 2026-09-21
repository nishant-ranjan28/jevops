import { z } from 'zod';

/**
 * Field-level validation for anything a model hands us.
 *
 * A model can return a field that is missing, the wrong type, or an enum value
 * that does not exist. None of that is allowed to reach Jev. Every field is
 * validated on its own: a valid field is kept, an invalid one is replaced with
 * the policy default and recorded as a repair, so the UI can show exactly what
 * the model got wrong instead of silently absorbing it.
 */

export interface FieldRepair {
  field: string;
  received: string;
  reason: string;
}

export interface ValidationReport {
  /** True when every field arrived valid. */
  ok: boolean;
  fieldsTotal: number;
  fieldsAccepted: number;
  repairs: FieldRepair[];
  /** True when the payload was not an object at all. */
  shapeRejected: boolean;
}

export const EMPTY_VALIDATION: ValidationReport = {
  ok: true,
  fieldsTotal: 0,
  fieldsAccepted: 0,
  repairs: [],
  shapeRejected: false,
};

function preview(value: unknown): string {
  if (value === undefined) return 'missing';
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return String(value);
  }
}

/**
 * Validate a raw payload against an object schema, one field at a time.
 * Never throws: the worst case is every field falling back to its default.
 */
export function parseFields<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  defaults: z.infer<z.ZodObject<Shape>>,
  raw: unknown,
): { value: z.infer<z.ZodObject<Shape>>; validation: ValidationReport } {
  const shape = schema.shape;
  const keys = Object.keys(shape);
  const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
  const source = isObject ? (raw as Record<string, unknown>) : null;

  const fallback = structuredClone(defaults) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const repairs: FieldRepair[] = [];

  for (const key of keys) {
    // z.safeParse (functional form) accepts the raw shape entries directly.
    const parsed = z.safeParse(shape[key], source ? source[key] : undefined);
    if (parsed.success) {
      out[key] = parsed.data;
      continue;
    }
    out[key] = fallback[key];
    repairs.push({
      field: key,
      received: preview(source ? source[key] : undefined),
      reason: parsed.error.issues[0]?.message ?? 'invalid value',
    });
  }

  return {
    value: out as z.infer<z.ZodObject<Shape>>,
    validation: {
      ok: repairs.length === 0 && isObject,
      fieldsTotal: keys.length,
      fieldsAccepted: keys.length - repairs.length,
      repairs,
      shapeRejected: !isObject,
    },
  };
}

/** Merge a nested report into a parent one, namespacing the field paths. */
export function mergeValidation(
  parent: ValidationReport,
  child: ValidationReport,
  prefix: string,
): ValidationReport {
  const repairs = [
    ...parent.repairs,
    ...child.repairs.map((r) => ({ ...r, field: `${prefix}.${r.field}` })),
  ];
  return {
    ok: parent.ok && child.ok,
    fieldsTotal: parent.fieldsTotal + child.fieldsTotal,
    fieldsAccepted: parent.fieldsAccepted + child.fieldsAccepted,
    repairs,
    shapeRejected: parent.shapeRejected || child.shapeRejected,
  };
}
