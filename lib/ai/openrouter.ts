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
}

export interface OpenRouterResponse {
  content: string;
  error?: string;
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
  const { apiKey, model = 'anthropic/claude-sonnet-4.6', maxTokens = 2000, cacheableSystemPrefix } = config;

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
        max_tokens: maxTokens,
        messages: payloadMessages,
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

    return { content: data.choices[0].message.content };
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
  const { apiKey, model = 'anthropic/claude-sonnet-4.6', maxTokens = 2000, cacheableSystemPrefix } = config;

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
      max_tokens: maxTokens,
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

/**
 * Get available models from OpenRouter
 */
export const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'x-ai/grok-4.3', name: 'Grok 4.3 (Grocky)' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-pro', name: 'Gemini Pro' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
];
