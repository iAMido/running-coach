/**
 * OpenRouter API client for AI coach integration
 */

import type { ChatMessage } from '@/lib/db/types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Fallback provider: NanoGPT (https://nano-gpt.com/api), used only when
 * OpenRouter itself fails (2026-09-27). Chosen because it is a second,
 * independent route to the SAME models under the SAME ids at the SAME prices
 * — measured: every MODEL_FOR model answers, streams, reasons and reports
 * `usage.cost` through it unchanged, with the account set to zero-data-
 * retention routes only. Active only when NANOGPT_API_KEY is set.
 */
const NANOGPT_API_URL = 'https://nano-gpt.com/api/v1/chat/completions';

type Provider = 'openrouter' | 'nanogpt';

/**
 * Whether a failure is OpenRouter's (worth trying the second provider) or the
 * request's own (would fail there too). Network errors, timeouts, 5xx, rate
 * limits, 402 (OpenRouter credits exhausted) and 401/403 (key revoked) fall
 * back; 400/404/422 — a malformed request or an unknown model — do not.
 */
export function shouldFallBack(status: number | null): boolean {
  if (status === null) return true; // network error / no response
  return status >= 500 || status === 429 || status === 408 || status === 402 || status === 401 || status === 403;
}

/**
 * The same request body for either provider. NanoGPT needs one addition:
 * `prompt_caching: { enabled: true }` — without it Opus 4.7 (the plan
 * writers) never cached there (0 of 4,129 tokens read on a repeat call); with
 * it the repeat read 4,123. OpenRouter needs no flag.
 */
export function requestBody(provider: Provider, model: string, base: Record<string, unknown>): Record<string, unknown> {
  return provider === 'nanogpt' && model.startsWith('anthropic/')
    ? { ...base, prompt_caching: { enabled: true } }
    : base;
}

function providerRequest(provider: Provider, openRouterKey: string): { url: string; headers: Record<string, string> } | null {
  if (provider === 'nanogpt') {
    const key = process.env.NANOGPT_API_KEY;
    if (!key) return null;
    return { url: NANOGPT_API_URL, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
  }
  return {
    url: OPENROUTER_API_URL,
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'AI Running Coach',
    },
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /**
   * @deprecated Caching the whole (RAG-bearing) system prompt never hits —
   * the prefix changes every call. Use cacheableSystemPrefix instead.
   * Kept as a no-op alias for one release so stray callers don't break.
   */
  cacheSystemPrompt?: boolean;
  /**
   * A byte-stable text block (persona + coaching rules, NO per-request
   * interpolation) placed FIRST in the system content with an Anthropic
   * cache_control breakpoint. Because it is identical across calls, cache
   * reads actually hit (~10% of input price after the first call in any
   * 5-minute window). The regular system message in `messages` becomes the
   * uncached dynamic block that follows it. Anthropic-only; other models
   * get the prefix inlined as plain text.
   */
  cacheableSystemPrefix?: string;
  /**
   * Thinking budget, in tokens, ON TOP OF `maxTokens`. Only meaningful for
   * models that reason (see MANDATORY_REASONING); omitted = the model's
   * default budget. `maxTokens` therefore keeps meaning "length of the
   * visible answer" whichever model a task is routed to.
   */
  reasoningTokens?: number;
}

/**
 * How each reasoning model's thinking is controlled. Measured 2026-09-26
 * when moving to Opus 5.5 / Sonnet 5 / Grok 4.7.
 *
 * Why this table exists: reasoning tokens count against `max_tokens`. Left
 * alone, a 300-token request to Opus 5.5 spent it thinking and returned
 * `finish_reason: length` with a truncated answer, and the SAME request
 * streamed returned nothing at all — the stream reader only yields
 * `delta.content`, and the budget ran out before any content began. Every
 * `maxTokens` in the app was sized for visible output, so thinking gets its
 * own headroom and is excluded from the response.
 *
 * - `mandatory`: OpenRouter rejects `reasoning: { enabled: false }` with
 *   "Reasoning is mandatory for this endpoint". Can only be bounded.
 * - `adaptive`: thinks on its own when a prompt looks hard — Sonnet 5 spent
 *   0 thinking tokens on a one-line question and 2,048 on the weekly-review
 *   prompt, unasked. Switched OFF unless a task asks for a budget, so a
 *   1,500-token chat answer cannot silently lose half its room to thinking
 *   and it behaves as Sonnet 4.6 did.
 *
 * The budget is HEADROOM, not a guarantee. Opus 5.5 treats it as a hint:
 * given 1,024 on a 12-week plan it thought for 14,241 tokens and ran out of
 * room at week 10. Grok 4.7 ignores a token budget entirely (2,859 used
 * against 2,048) but does honour `effort`, so it is controlled that way —
 * `low` halved Grocky's plan review from 81 s to 40 s.
 */
const REASONING_POLICY: Record<string, { kind: 'mandatory' | 'adaptive'; defaultBudget: number; effort?: 'low' | 'medium' | 'high' }> = {
  'anthropic/claude-opus-5.5': { kind: 'mandatory', defaultBudget: 2_048 },
  'x-ai/grok-4.7':             { kind: 'mandatory', defaultBudget: 4_000, effort: 'low' },
  'anthropic/claude-sonnet-5': { kind: 'adaptive',  defaultBudget: 2_048 },
};

type ReasoningField =
  | { max_tokens: number; exclude: true }
  | { effort: 'low' | 'medium' | 'high'; exclude: true }
  | { enabled: false };

/** `max_tokens` + `reasoning` body fields for a model. Exported for tests. */
export function tokenFields(
  model: string,
  maxTokens: number,
  reasoningTokens?: number,
): { max_tokens: number; reasoning?: ReasoningField } {
  const policy = REASONING_POLICY[model];
  const wantsThinking = reasoningTokens === undefined ? policy?.kind === 'mandatory' : reasoningTokens > 0;
  if (!wantsThinking) {
    if (policy?.kind === 'adaptive') return { max_tokens: maxTokens, reasoning: { enabled: false } };
    if (policy?.kind !== 'mandatory') return { max_tokens: maxTokens };
  }
  // 1,024 is Anthropic's minimum thinking budget.
  const budget = Math.max(1_024, reasoningTokens || policy?.defaultBudget || 1_024);
  const reasoning: ReasoningField = policy?.effort
    ? { effort: policy.effort, exclude: true }
    : { max_tokens: budget, exclude: true };
  return { max_tokens: maxTokens + budget, reasoning };
}

export interface OpenRouterResponse {
  content: string;
  error?: string;
  /**
   * Why generation stopped: 'stop' (finished), 'length' (hit maxTokens and was
   * CUT OFF), etc. Previously discarded, which meant a plan truncated mid-JSON
   * at the token cap was indistinguishable from a model that emitted malformed
   * JSON — both surfaced only as "failed to parse". 'length' is the one to act
   * on: the content is incomplete by construction.
   */
  finishReason?: string | null;
  /** Output tokens used, when the provider reports it. Includes reasoning. */
  completionTokens?: number | null;
  /** Of `completionTokens`, how many were hidden reasoning. */
  reasoningTokensUsed?: number | null;
  promptTokens?: number | null;
  /** Of `promptTokens`, how many were read from the prompt cache (billed at ~10%). */
  cachedTokens?: number | null;
  /** What the provider actually charged for the call, USD. */
  costUsd?: number | null;
  /** Which provider answered — 'nanogpt' means OpenRouter failed and the fallback served it. */
  provider?: 'openrouter' | 'nanogpt';
}

/**
 * Merge a stable cacheable prefix with the dynamic system message.
 * Anthropic path: one system message whose content is
 *   [ {static, cache_control}, {dynamic} ]
 * so the cache breakpoint covers only the byte-identical prefix.
 * Non-Anthropic path: plain-text concatenation.
 */
function applySystemPrefix(
  messages: ChatMessage[],
  prefix: string,
  isAnthropic: boolean,
): unknown[] {
  let merged = false;
  return messages.map(m => {
    if (!merged && m.role === 'system' && typeof m.content === 'string') {
      merged = true;
      if (isAnthropic) {
        return {
          role: 'system',
          content: [
            { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: m.content },
          ],
        };
      }
      return { role: 'system', content: `${prefix}\n\n${m.content}` };
    }
    return m;
  });
}

/**
 * Call OpenRouter API with messages
 */
export async function callOpenRouter(
  messages: ChatMessage[],
  config: OpenRouterConfig
): Promise<OpenRouterResponse> {
  const { apiKey, model = 'anthropic/claude-sonnet-5', maxTokens = 2000, cacheableSystemPrefix, reasoningTokens } = config;

  if (!apiKey) {
    return { content: '', error: 'OpenRouter API key not configured.' };
  }

  const payloadMessages = cacheableSystemPrefix
    ? applySystemPrefix(messages, cacheableSystemPrefix, model.startsWith('anthropic/'))
    : messages;
  const base = {
    model,
    ...tokenFields(model, maxTokens, reasoningTokens),
    messages: payloadMessages,
    // Usage accounting: both providers return the actual charge and cache
    // reads, so cost is measured rather than estimated from token counts.
    usage: { include: true },
  };

  const primary = await postChat('openrouter', apiKey, model, base);
  if (primary.ok || !shouldFallBack(primary.status) || !process.env.NANOGPT_API_KEY) return primary.result;

  console.warn(`OpenRouter failed (${primary.status ?? 'network'}: ${primary.result.error}); retrying ${model} on NanoGPT`);
  const fallback = await postChat('nanogpt', apiKey, model, base);
  if (fallback.ok) return fallback.result;
  return {
    content: '',
    error: `OpenRouter failed (${primary.result.error}) and the NanoGPT fallback failed too (${fallback.result.error}).`,
  };
}

/** One chat call to one provider. `status` is null when no HTTP response arrived. */
async function postChat(
  provider: Provider, openRouterKey: string, model: string, base: Record<string, unknown>,
): Promise<{ ok: boolean; status: number | null; result: OpenRouterResponse }> {
  const req = providerRequest(provider, openRouterKey);
  if (!req) return { ok: false, status: null, result: { content: '', error: `${provider} is not configured` } };
  const name = provider === 'nanogpt' ? 'NanoGPT' : 'OpenRouter';
  try {
    const response = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(requestBody(provider, model, base)) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      // OpenRouter sometimes answers 200 with an error body carrying the real code.
      const code = typeof data.error?.code === 'number' ? data.error.code : response.ok ? 502 : response.status;
      const message = (typeof data.error === 'string' ? data.error : data.error?.message) || `${name} error ${response.status}`;
      return { ok: false, status: code, result: { content: '', error: message } };
    }
    if (!data.choices || data.choices.length === 0) {
      return { ok: false, status: 502, result: { content: '', error: `No response from model (${name})` } };
    }
    return {
      ok: true,
      status: response.status,
      result: {
        content: data.choices[0].message.content,
        finishReason: data.choices[0].finish_reason ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
        reasoningTokensUsed: data.usage?.completion_tokens_details?.reasoning_tokens ?? data.usage?.reasoning_tokens ?? null,
        promptTokens: data.usage?.prompt_tokens ?? null,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? data.usage?.cache_read_input_tokens ?? null,
        costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : null,
        provider,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, status: null, result: { content: '', error: `Failed to call ${name}: ${message}` } };
  }
}

/**
 * Create a streaming call to OpenRouter
 */
export async function* streamOpenRouter(
  messages: ChatMessage[],
  config: OpenRouterConfig
): AsyncGenerator<string, void, unknown> {
  const { apiKey, model = 'anthropic/claude-sonnet-5', maxTokens = 2000, cacheableSystemPrefix, reasoningTokens } = config;

  if (!apiKey) {
    throw new Error('OpenRouter API key not configured.');
  }

  const payloadMessages = cacheableSystemPrefix
    ? applySystemPrefix(messages, cacheableSystemPrefix, model.startsWith('anthropic/'))
    : messages;

  const base = { model, ...tokenFields(model, maxTokens, reasoningTokens), messages: payloadMessages, stream: true };
  type Opened = Response | { status: number | null; error: string };
  const open = async (provider: Provider): Promise<Opened> => {
    const req = providerRequest(provider, apiKey);
    if (!req) return { status: null, error: `${provider} is not configured` };
    try {
      return await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(requestBody(provider, model, base)) });
    } catch (e) {
      return { status: null, error: e instanceof Error ? e.message : 'network error' };
    }
  };

  // Fallback happens only BEFORE the first token: once text has streamed, a
  // switch would splice two different answers together.
  let response: Opened = await open('openrouter');
  if (!(response instanceof Response && response.ok) && process.env.NANOGPT_API_KEY && shouldFallBack(response.status)) {
    console.warn(`OpenRouter stream failed (${response.status ?? 'network'}); retrying ${model} on NanoGPT`);
    response = await open('nanogpt');
  }
  if (!(response instanceof Response)) throw new Error(`API error: ${response.error}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}
