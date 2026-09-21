import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { mergeValidation, parseFields } from '../src/lib/jev/parse';

const schema = z.object({
  name: z.string(),
  count: z.number().int().nullable(),
  level: z.enum(['low', 'high']),
  tags: z.array(z.string()),
});

const defaults: z.infer<typeof schema> = {
  name: 'unknown',
  count: null,
  level: 'low',
  tags: [],
};

test('valid payload passes through untouched', () => {
  const { value, validation } = parseFields(schema, defaults, {
    name: 'svc',
    count: 3,
    level: 'high',
    tags: ['x'],
  });
  assert.deepEqual(value, { name: 'svc', count: 3, level: 'high', tags: ['x'] });
  assert.equal(validation.ok, true);
  assert.equal(validation.repairs.length, 0);
  assert.equal(validation.fieldsAccepted, 4);
});

test('an invalid enum from the model is rejected and defaulted, not passed on', () => {
  const { value, validation } = parseFields(schema, defaults, {
    name: 'svc',
    count: 1,
    level: 'catastrophic',
    tags: [],
  });
  assert.equal(value.level, 'low', 'invalid enum must not reach the policy');
  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.repairs.map((r) => r.field),
    ['level'],
  );
  assert.match(validation.repairs[0].received, /catastrophic/);
});

test('wrong types and missing fields are repaired field by field', () => {
  const { value, validation } = parseFields(schema, defaults, { name: 42, level: 'high' });
  assert.equal(value.name, 'unknown');
  assert.equal(value.level, 'high', 'valid siblings survive a bad neighbour');
  assert.equal(value.count, null);
  assert.equal(validation.repairs.length, 3);
  assert.equal(validation.fieldsAccepted, 1);
});

test('a non-object payload defaults everything and is flagged', () => {
  const { value, validation } = parseFields(schema, defaults, 'not json at all');
  assert.deepEqual(value, defaults);
  assert.equal(validation.shapeRejected, true);
  assert.equal(validation.ok, false);
});

test('defaults are cloned, so one bad run cannot poison the next', () => {
  const first = parseFields(schema, defaults, {});
  first.value.tags.push('mutated');
  const second = parseFields(schema, defaults, {});
  assert.deepEqual(second.value.tags, []);
});

test('nested reports merge with namespaced field paths', () => {
  const parent = parseFields(schema, defaults, { name: 1 }).validation;
  const child = parseFields(schema, defaults, { level: 'nope' }).validation;
  const merged = mergeValidation(parent, child, 'facts');
  assert.ok(merged.repairs.some((r) => r.field === 'facts.level'));
  assert.equal(merged.ok, false);
  assert.equal(merged.fieldsTotal, 8);
});
