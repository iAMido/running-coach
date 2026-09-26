/**
 * OpenRouter API client for AI coach integration
 */

import type { ChatMessage } from '@/lib/db/types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
  /** What OpenRouter actually charged for the call, USD. */
  costUsd?: number | null;
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

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'AI Running Coach',
      },
      body: JSON.stringify({
        model,
        ...tokenFields(model, maxTokens, reasoningTokens),
        messages: payloadMessages,
        // OpenRouter usage accounting: returns the actual charge and cache
        // reads, so cost is measured rather than estimated from token counts.
        usage: { include: true },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `API error: ${response.status}`;
      return { content: '', error: errorMessage };
    }

    const data = await response.json();

    if (data.error) {
      return { content: '', error: data.error.message || 'Unknown error' };
    }

    if (!data.choices || data.choices.length === 0) {
      return { content: '', error: 'No response from model' };
    }

    return {
      content: data.choices[0].message.content,
      finishReason: data.choices[0].finish_reason ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      reasoningTokensUsed: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      promptTokens: data.usage?.prompt_tokens ?? null,
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? null,
      costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { content: '', error: `Failed to call OpenRouter: ${message}` };
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

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'AI Running Coach',
    },
    body: JSON.stringify({
      model,
      ...tokenFields(model, maxTokens, reasoningTokens),
      messages: payloadMessages,
      stream: true,
    }),
  });

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
