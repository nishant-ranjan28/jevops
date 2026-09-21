import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsonObject } from '../src/lib/llm/json';

test('parses a clean JSON object', () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
});

test('unwraps a fenced code block', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
});

test('recovers an object buried in prose', () => {
  const raw = 'Sure! Here is the analysis you asked for:\n{"a":1,"b":{"c":2}}\nHope that helps.';
  assert.deepEqual(extractJsonObject(raw), { a: 1, b: { c: 2 } });
});

test('tolerates a trailing comma', () => {
  assert.deepEqual(extractJsonObject('{"a":1,}'), { a: 1 });
});

test('is not fooled by braces inside strings', () => {
  assert.deepEqual(extractJsonObject('{"a":"}{"}'), { a: '}{' });
});

test('throws when there is no object at all', () => {
  assert.throws(() => extractJsonObject('no json here'), /no JSON object/);
});
