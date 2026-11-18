import { afterEach, describe, expect, test } from 'bun:test';
import { callOpenRouter, defaultTimeoutMs, fallbackTimeoutMs, FUNCTION_BUDGET_MS, streamOpenRouter } from '@/lib/ai/openrouter';
import { MODEL_FOR, REASONING_FOR } from '@/lib/ai/model-registry';

describe('defaultTimeoutMs', () => {
  test('fits every call duration measured in coach_calls (2026-11-18)', () => {
    // chat: max 32 s observed
    expect(defaultTimeoutMs(MODEL_FOR.chat_default, 1500)).toBeGreaterThan(32_000 * 1.5);
    // weekly review: max 73 s observed
    expect(defaultTimeoutMs(MODEL_FOR.weekly_review, 5000, REASONING_FOR.weekly_review)).toBeGreaterThan(73_000 * 1.5);
  });

  test('a tiny call still gets 30 s; nothing gets past 240 s', () => {
    expect(defaultTimeoutMs(MODEL_FOR.chat_quick, 120)).toBe(30_000);
    expect(defaultTimeoutMs(MODEL_FOR.plan_generation, 64_000)).toBe(240_000);
  });
});

describe('fallbackTimeoutMs', () => {
  test('a fallback after a fast failure gets the full limit', () => {
    expect(fallbackTimeoutMs(60_000, 2_000)).toBe(60_000);
  });
  test('never runs past the function budget', () => {
    expect(fallbackTimeoutMs(240_000, 200_000)).toBe(FUNCTION_BUDGET_MS - 200_000);
  });
  test('not started with too little time left', () => {
    expect(fallbackTimeoutMs(280_000, 280_000)).toBeNull();
  });
});

describe('a hung provider', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  /**
   * Never answers; rejects only when the request's signal aborts. The interval
   * stands in for the open socket a real hung fetch holds: AbortSignal.timeout's
   * timer is unref'd, so with nothing else alive the runtime would just idle.
   */
  function hangingFetch() {
    return ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      const socket = setInterval(() => {}, 1_000);
      init?.signal?.addEventListener('abort', () => { clearInterval(socket); reject(init.signal!.reason); });
    })) as unknown as typeof fetch;
  }

  test('callOpenRouter returns a timeout error instead of waiting forever', async () => {
    globalThis.fetch = hangingFetch();
    const t = Date.now();
    const r = await callOpenRouter([{ role: 'user', content: 'hi' }], { apiKey: 'k', model: 'anthropic/claude-haiku-4.5', maxTokens: 10, timeoutMs: 50 });
    expect(r.error).toContain('timed out');
    expect(Date.now() - t).toBeLessThan(2_000);
  });

  test('streamOpenRouter throws on a timeout', async () => {
    globalThis.fetch = hangingFetch();
    const run = async () => {
      const tokens = streamOpenRouter([{ role: 'user', content: 'hi' }], { apiKey: 'k', model: 'anthropic/claude-haiku-4.5', maxTokens: 10, timeoutMs: 50 });
      await tokens.next();
    };
    await expect(run()).rejects.toThrow('timed out');
  });
});
