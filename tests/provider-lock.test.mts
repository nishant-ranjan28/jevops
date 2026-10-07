/**
 * A public deployment must not let visitors choose the provider or model.
 *
 * Covers the two locks: `LLM_PROVIDER=mock` cannot be overridden per request,
 * and `/api/analyze` ignores body `provider` / `model` unless
 * `ALLOW_CLIENT_PROVIDER_OVERRIDE=1`. A local server stands in for OpenRouter
 * and records every call, so "no key was spent" is asserted directly.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { POST } from '../src/app/api/analyze/route';
import { GET as status } from '../src/app/api/status/route';
import { resolveProviderChain } from '../src/lib/llm/provider';

let server: Server;
let baseUrl: string;
let models: (string | undefined)[] = [];

const INPUT = 'Deploying checkout-api v4.12. Error rate is 2.4% versus a 0.3% baseline.';

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      models.push((raw ? JSON.parse(raw) : {}).model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  models = [];
  for (const name of [
    'LLM_PROVIDER',
    'ALLOW_CLIENT_PROVIDER_OVERRIDE',
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'OPENROUTER_MODEL',
    'GROQ_API_KEY',
    'GROQ_BASE_URL',
    'GROQ_MODEL',
  ]) {
    delete process.env[name];
  }
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = baseUrl;
  process.env.OPENROUTER_MODEL = 'configured-model';
});

async function analyze(body: Record<string, unknown>) {
  const response = await POST(
    new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'deploy-gate', input: INPUT, ...body }),
    }),
  );
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; meta?: { servedBy?: string } });
  return events.find((e) => e.type === 'meta')?.meta;
}

test('LLM_PROVIDER=mock cannot be overridden by a preferred provider', () => {
  process.env.LLM_PROVIDER = 'mock';
  const { chain } = resolveProviderChain('openrouter', 'some-expensive-model');
  assert.equal(chain.length, 1);
  assert.equal(chain[0].provider.isMock, true);
});

test('status reports configured keys even when pinned to mock', async () => {
  process.env.LLM_PROVIDER = 'mock';
  const body = await status().json();
  assert.equal(body.provider, 'mock');
  assert.deepEqual(body.configured, ['openrouter']);
});

test('a request cannot leave mock mode when LLM_PROVIDER=mock', async () => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.ALLOW_CLIENT_PROVIDER_OVERRIDE = '1';
  const meta = await analyze({ provider: 'openrouter', model: 'some-expensive-model' });
  assert.equal(meta?.servedBy, 'mock');
  assert.equal(models.length, 0, 'no call reached the provider');
});

test('body provider and model are ignored without ALLOW_CLIENT_PROVIDER_OVERRIDE', async () => {
  await analyze({ provider: 'openrouter', model: 'some-expensive-model' });
  assert.ok(models.length > 0, 'the configured provider served the run');
  assert.ok(
    models.every((m) => m === 'configured-model'),
    'the client-chosen model never reached the provider',
  );
});

test('body model is honoured when ALLOW_CLIENT_PROVIDER_OVERRIDE=1', async () => {
  process.env.ALLOW_CLIENT_PROVIDER_OVERRIDE = '1';
  await analyze({ provider: 'openrouter', model: 'chosen-model' });
  assert.ok(models.includes('chosen-model'));
});
