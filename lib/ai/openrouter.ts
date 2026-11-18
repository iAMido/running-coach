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
  /**
   * Give up on one provider after this long. Default: `defaultTimeoutMs`,
   * which scales with the call's token budget. A timeout counts as a provider
   * failure, so it falls back to NanoGPT when there is time left.
   */
  timeoutMs?: number;
  /**
   * Also cache the conversation: a second Anthropic breakpoint on the message
   * just before the final user turn, so the history up to the coach's last
   * reply is read from cache on the next turn. Only useful when nothing
   * per-turn sits before the history (see lib/coach/chat-turn.ts).
   */
  cacheConversation?: boolean;
}

/**
 * Before 2026-11-18 no AI fetch had a timeout: a hung connection waited until
 * Vercel killed the function at 300 s, and the NanoGPT fallback never ran,
 * because it only fires on an error.
 */
/** What one request may spend in total, primary + fallback, under Vercel's 300 s function limit. */
export const FUNCTION_BUDGET_MS = 285_000;
/** A fallback with less time than this left is not worth starting. */
const MIN_FALLBACK_MS = 15_000;

/**
 * Generous by design — a timeout that cuts off a call which would have
 * finished is worse than none: 20 s + the whole output budget (answer +
 * thinking headroom) at 40 tok/s, between 30 s and 240 s. Measured maxima in
 * coach_calls (2026-11-18) all fit: chat 32 s (limit 57 s), weekly review
 * 73 s (196 s), plan writers 56 s. The plan outline has taken 272 s, so the
 * builder passes its own limit.
 */
export function defaultTimeoutMs(model: string, maxTokens: number, reasoningTokens?: number): number {
  const total = tokenFields(model, maxTokens, reasoningTokens).max_tokens;
  return Math.min(240_000, Math.max(30_000, Math.round(20_000 + (total / 40) * 1000)));
}

/**
 * The fallback's timeout: the same limit, but never past the function budget
 * measured from when the call began. `null` = not enough time left to try.
 */
export function fallbackTimeoutMs(timeoutMs: number, elapsedMs: number): number | null {
  const left = Math.min(timeoutMs, FUNCTION_BUDGET_MS - elapsedMs);
  return left >= MIN_FALLBACK_MS ? left : null;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
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
  // No dynamic system message (the chat now puts its per-turn context in the
  // user turn): the prefix becomes the whole system message.
  if (!messages.some(m => m.role === 'system' && typeof m.content === 'string')) {
    const system = isAnthropic
      ? { role: 'system', content: [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }] }
      : { role: 'system', content: prefix };
    return [system, ...messages];
  }
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
 * The messages as sent: the cacheable system prefix applied and, with
 * `cacheConversation`, a second breakpoint on the last message before the
 * final user turn, so the conversation so far is read from cache. Anthropic
 * only; other models get the messages with just the prefix inlined.
 */
export function payloadFor(
  messages: ChatMessage[],
  model: string,
  cacheableSystemPrefix?: string,
  cacheConversation?: boolean,
): unknown[] {
  const isAnthropic = model.startsWith('anthropic/');
  const withPrefix: unknown[] = cacheableSystemPrefix
    ? applySystemPrefix(messages, cacheableSystemPrefix, isAnthropic)
    : [...messages];
  if (!cacheConversation || !isAnthropic) return withPrefix;
  const roles = withPrefix.map((m) => (m as { role: string }).role);
  const target = roles.lastIndexOf('user') - 1;
  // Nothing before the final turn but the system message: breakpoint 1 covers it.
  if (target < 0 || roles[target] === 'system') return withPrefix;
  const m = withPrefix[target] as { role: string; content: unknown };
  if (typeof m.content !== 'string') return withPrefix;
  withPrefix[target] = {
    role: m.role,
    content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
  };
  return withPrefix;
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

  const payloadMessages = payloadFor(messages, model, cacheableSystemPrefix, config.cacheConversation);
  const base = {
    model,
    ...tokenFields(model, maxTokens, reasoningTokens),
    messages: payloadMessages,
    // Usage accounting: both providers return the actual charge and cache
    // reads, so cost is measured rather than estimated from token counts.
    usage: { include: true },
  };

  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs(model, maxTokens, reasoningTokens);
  const started = Date.now();
  const primary = await postChat('openrouter', apiKey, model, base, timeoutMs);
  if (primary.ok || !shouldFallBack(primary.status) || !process.env.NANOGPT_API_KEY) return primary.result;

  const fallbackMs = fallbackTimeoutMs(timeoutMs, Date.now() - started);
  if (fallbackMs === null) return primary.result;
  console.warn(`OpenRouter failed (${primary.status ?? 'network'}: ${primary.result.error}); retrying ${model} on NanoGPT`);
  const fallback = await postChat('nanogpt', apiKey, model, base, fallbackMs);
  if (fallback.ok) return fallback.result;
  return {
    content: '',
    error: `OpenRouter failed (${primary.result.error}) and the NanoGPT fallback failed too (${fallback.result.error}).`,
  };
}

/** One chat call to one provider. `status` is null when no HTTP response arrived. */
async function postChat(
  provider: Provider, openRouterKey: string, model: string, base: Record<string, unknown>, timeoutMs: number,
): Promise<{ ok: boolean; status: number | null; result: OpenRouterResponse }> {
  const req = providerRequest(provider, openRouterKey);
  if (!req) return { ok: false, status: null, result: { content: '', error: `${provider} is not configured` } };
  const name = provider === 'nanogpt' ? 'NanoGPT' : 'OpenRouter';
  try {
    // The signal covers the body read too, so a response that stalls midway is cut as well.
    const response = await fetch(req.url, {
      method: 'POST', headers: req.headers, body: JSON.stringify(requestBody(provider, model, base)),
      signal: AbortSignal.timeout(timeoutMs),
    });
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
    if (isTimeout(error)) {
      return { ok: false, status: null, result: { content: '', error: `${name} timed out after ${Math.round(timeoutMs / 1000)} s` } };
    }
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

  const payloadMessages = payloadFor(messages, model, cacheableSystemPrefix, config.cacheConversation);

  const base = { model, ...tokenFields(model, maxTokens, reasoningTokens), messages: payloadMessages, stream: true };
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs(model, maxTokens, reasoningTokens);
  const started = Date.now();
  type Opened = Response | { status: number | null; error: string };
  // The signal stays on the response, so it also bounds the stream read below.
  const open = async (provider: Provider, ms: number): Promise<Opened> => {
    const req = providerRequest(provider, apiKey);
    if (!req) return { status: null, error: `${provider} is not configured` };
    try {
      return await fetch(req.url, {
        method: 'POST', headers: req.headers, body: JSON.stringify(requestBody(provider, model, base)),
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) {
      if (isTimeout(e)) return { status: null, error: `timed out after ${Math.round(ms / 1000)} s` };
      return { status: null, error: e instanceof Error ? e.message : 'network error' };
    }
  };

  // Fallback happens only BEFORE the first token: once text has streamed, a
  // switch would splice two different answers together.
  let response: Opened = await open('openrouter', timeoutMs);
  const fallbackMs = fallbackTimeoutMs(timeoutMs, Date.now() - started);
  if (!(response instanceof Response && response.ok) && process.env.NANOGPT_API_KEY && shouldFallBack(response.status) && fallbackMs !== null) {
    console.warn(`OpenRouter stream failed (${response.status ?? 'network'}); retrying ${model} on NanoGPT`);
    response = await open('nanogpt', fallbackMs);
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
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      // Thrown, not swallowed: a stream cut short must not look like a finished answer.
      if (isTimeout(e)) throw new Error(`Stream timed out after ${Math.round(timeoutMs / 1000)} s`);
      throw e;
    }
    const { done, value } = chunk;
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
