export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Ask the provider for a JSON object response where supported. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly isMock: boolean;
  complete(request: CompletionRequest): Promise<string>;
}

export type ProviderId = 'openrouter' | 'groq' | 'mock';


interface OpenAiCompatibleConfig {
  id: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra headers some gateways want for attribution. */
  headers?: Record<string, string>;
}

/**
 * Pull the human-readable reason out of a provider error body. Raw bodies
 * carry account identifiers and request ids that have no business being
 * rendered in the UI, so only the message survives.
 */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    const message =
      typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    if (message) return message.slice(0, 300);
  } catch {
    // Not JSON — fall through to the trimmed raw body.
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 200);
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

/**
 * OpenRouter and Groq both speak the OpenAI chat-completions dialect,
 * so a single transport covers both. Adding Ollama later is another
 * config object, not another code path.
 */
function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    id: config.id,
    model: config.model,
    isMock: false,
    async complete({ messages, json, temperature = 0.2, maxTokens = 1400, signal }) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          ...config.headers,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${config.id} returned ${response.status}: ${errorMessage(text)}`);
      }

      let parsed: ChatCompletionResponse;
      try {
        parsed = JSON.parse(text) as ChatCompletionResponse;
      } catch {
        throw new Error(`${config.id} returned a non-JSON body: ${text.slice(0, 200)}`);
      }
      if (parsed.error?.message) throw new Error(`${config.id} error: ${parsed.error.message}`);

      const content = parsed.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${config.id} returned an empty completion.`);
      return content;
    },
  };
}

export const mockProvider: LlmProvider = {
  id: 'mock',
  model: 'jevops-deterministic-mock',
  isMock: true,
  async complete() {
    throw new Error('The mock provider is handled by the pipeline, not by direct completion.');
  },
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export interface ProviderResolution {
  provider: LlmProvider;
  /** Why we ended up on this provider — surfaced in the UI. */
  reason: string;
}

export interface ProviderChain {
  /** Ordered candidates. Always ends with the deterministic mock. */
  chain: ProviderResolution[];
  /** Ids of the live providers that have keys configured. */
  configured: ProviderId[];
}

/**
 * Build the ordered list of providers to try for one run.
 *
 * Resilience is the point: if the primary provider is down, rate limited, or
 * has lost the model we asked for, the next one takes over and the run still
 * completes. The chain always ends with the deterministic mock, so a demo
 * never dies on someone else's outage.
 *
 * Order:
 *   1. the explicitly requested provider (LLM_PROVIDER or a per-request override)
 *   2. the other configured provider
 *   3. the deterministic mock
 *
 * Keys are read server-side only and never returned to the client.
 *
 * `modelOverride` applies only to the explicitly requested provider — a model
 * id that exists on Groq generally does not exist on OpenRouter, so fallbacks
 * use their own configured model.
 */
export function resolveProviderChain(
  preferred?: string,
  modelOverride?: string,
): ProviderChain {
  const requested = (preferred ?? env('LLM_PROVIDER') ?? '').toLowerCase();
  const override = modelOverride?.trim() || undefined;

  if (requested === 'mock') {
    return {
      chain: [{ provider: mockProvider, reason: 'Mock mode requested explicitly.' }],
      configured: [],
    };
  }

  const openrouterKey = env('OPENROUTER_API_KEY');
  const groqKey = env('GROQ_API_KEY');

  const buildOpenRouter = (useOverride: boolean): ProviderResolution | null => {
    if (!openrouterKey) return null;
    return {
      provider: createOpenAiCompatibleProvider({
        id: 'openrouter',
        baseUrl: env('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1',
        apiKey: openrouterKey,
        model: (useOverride ? override : undefined) ?? env('OPENROUTER_MODEL') ?? 'openai/gpt-4o-mini',
        headers: {
          'HTTP-Referer': env('OPENROUTER_SITE_URL') ?? 'http://localhost:3000',
          'X-Title': 'JevOps',
        },
      }),
      reason: 'Using OpenRouter.',
    };
  };

  const buildGroq = (useOverride: boolean): ProviderResolution | null => {
    if (!groqKey) return null;
    return {
      provider: createOpenAiCompatibleProvider({
        id: 'groq',
        baseUrl: env('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1',
        apiKey: groqKey,
        model: (useOverride ? override : undefined) ?? env('GROQ_MODEL') ?? 'openai/gpt-oss-120b',
      }),
      reason: 'Using Groq.',
    };
  };

  // Preferred first, then the other one as a standby.
  const explicit = requested === 'openrouter' || requested === 'groq';
  const ordered: (ProviderResolution | null)[] =
    requested === 'groq'
      ? [buildGroq(true), buildOpenRouter(false)]
      : requested === 'openrouter'
        ? [buildOpenRouter(true), buildGroq(false)]
        : [buildOpenRouter(!explicit), buildGroq(!explicit)];

  const live = ordered.filter((r): r is ProviderResolution => r !== null);
  const configured = live.map((r) => r.provider.id);

  if (live.length === 0) {
    const reason = explicit
      ? `${requested.toUpperCase()}_API_KEY is not set — falling back to mock mode.`
      : 'No provider key configured — running the deterministic mock.';
    return { chain: [{ provider: mockProvider, reason }], configured };
  }

  // The standby is named up front so the UI can say what cover exists.
  const standby = live.slice(1).map((r) => r.provider.id);
  const head: ProviderResolution = {
    ...live[0],
    reason: standby.length
      ? `${live[0].reason} ${standby.join(' and ')} on standby.`
      : live[0].reason,
  };

  return {
    chain: [
      head,
      ...live.slice(1),
      { provider: mockProvider, reason: 'All configured providers failed — using the deterministic mock.' },
    ],
    configured,
  };
}

/** The provider a run starts with. Used for status and first paint. */
export function resolveProvider(preferred?: string, modelOverride?: string): ProviderResolution {
  return resolveProviderChain(preferred, modelOverride).chain[0];
}
