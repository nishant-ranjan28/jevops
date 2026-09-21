import { resolveProviderChain } from '@/lib/llm/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Provider status for the header badge. Never returns key material. */
export function GET(): Response {
  const { chain, configured } = resolveProviderChain();
  const [head] = chain;
  return Response.json({
    provider: head.provider.id,
    model: head.provider.model,
    mock: head.provider.isMock,
    reason: head.reason,
    // The full failover order, so it is obvious what cover exists.
    chain: chain.map((c) => ({ provider: c.provider.id, model: c.provider.model })),
    configured,
  });
}
