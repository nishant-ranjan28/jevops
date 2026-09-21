import { parsePullRequestUrl } from '@/lib/github/url';
import { runAnalysis } from '@/lib/pipeline';
import { isModeId, type AnalysisEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_INPUT = 24_000;
const MAX_PR_URL = 400;
/** Mock mode returns instantly; a little pacing keeps the stage readout legible. */
const MOCK_STAGE_PACE_MS = 240;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const { mode, input, prUrl, provider, model } = (body ?? {}) as {
    mode?: unknown;
    input?: unknown;
    prUrl?: unknown;
    provider?: unknown;
    model?: unknown;
  };

  if (model !== undefined && (typeof model !== 'string' || model.length > 120)) {
    return Response.json({ error: 'model must be a short string.' }, { status: 400 });
  }

  if (!isModeId(mode)) {
    return Response.json({ error: 'Unknown mode.' }, { status: 400 });
  }

  const live = typeof prUrl === 'string' && prUrl.trim().length > 0;

  if (live) {
    if ((prUrl as string).length > MAX_PR_URL) {
      return Response.json({ error: 'That URL is implausibly long.' }, { status: 413 });
    }
    // Reject malformed URLs before opening a stream, so the client gets a
    // plain 400 rather than a stream whose first event is an error.
    const parsed = parsePullRequestUrl(prUrl as string);
    if (!parsed.ok) {
      return Response.json({ error: parsed.reason }, { status: 400 });
    }
  } else {
    if (typeof input !== 'string' || input.trim().length === 0) {
      return Response.json({ error: 'Input is required.' }, { status: 400 });
    }
    if (input.length > MAX_INPUT) {
      return Response.json({ error: `Input exceeds ${MAX_INPUT} characters.` }, { status: 413 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        // Mock mode returns instantly; pace the stage events so the
        // pipeline readout is legible during a live demo.
        let pace = false;
        for await (const event of runAnalysis({
          mode,
          input: typeof input === 'string' ? input : '',
          prUrl: live ? (prUrl as string) : undefined,
          providerOverride: typeof provider === 'string' ? provider : undefined,
          modelOverride: typeof model === 'string' ? model : undefined,
          signal: request.signal,
        })) {
          if (event.type === 'meta') pace = event.meta.source === 'mock';
          send(event);
          if (pace && event.type === 'stage' && event.status === 'start') {
            await sleep(MOCK_STAGE_PACE_MS);
          }
        }
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Analysis failed.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
