/**
 * The builder's one way to call a model: cached coach prefix, per-task model
 * and thinking budget, actual cost metered, one coach_calls row per call.
 */

import { callOpenRouter, type OpenRouterResponse } from '@/lib/ai/openrouter';
import { COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { MODEL_FOR, REASONING_FOR, type ModelTaskKey } from '@/lib/ai/model-registry';
import { logCoachCall } from '@/lib/supervisor';

const ROUTE = '/api/coach/plans/build';

/** Accumulates what a stage's model calls actually cost (OpenRouter usage accounting). */
export class Meter {
  cost = 0;
  prompt = 0;
  cached = 0;
  add(r: OpenRouterResponse) {
    this.cost += r.costUsd ?? 0;
    this.prompt += r.promptTokens ?? 0;
    this.cached += r.cachedTokens ?? 0;
  }
  get summary() {
    return { cost: Math.round(this.cost * 1000) / 1000, prompt: this.prompt, cached: this.cached };
  }
}

export async function ask(
  userId: string, task: ModelTaskKey, system: string, user: string, maxTokens: number,
  meter: Meter, sharedPrefix?: string,
): Promise<OpenRouterResponse & { ms: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OpenRouter API key not configured');
  const t = Date.now();
  const r = await callOpenRouter(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    {
      apiKey, model: MODEL_FOR[task], maxTokens, reasoningTokens: REASONING_FOR[task],
      // The cached prefix is the byte-stable part: the coach persona, plus —
      // for writers — everything every writer in this build shares.
      cacheableSystemPrefix: sharedPrefix ? `${COACH_STATIC_BLOCK}\n\n${sharedPrefix}` : COACH_STATIC_BLOCK,
    },
  );
  meter.add(r);
  const ms = Date.now() - t;
  // Best-effort telemetry: one coach_calls row per model call, same table the
  // supervisor's weekly health audit already reads.
  logCoachCall({
    // Records the provider when the NanoGPT fallback answered, so a fallback
    // day is visible in coach_calls rather than looking like a normal one.
    user_id: userId, route: ROUTE, query_type: 'plan_generation', model: r.provider === 'nanogpt' ? `${MODEL_FOR[task]} (nanogpt)` : MODEL_FOR[task],
    context_tokens: r.promptTokens ?? Math.round((system.length + (sharedPrefix?.length ?? 0)) / 4), context_budget: null, ceiling_hit: false,
    cache_used: (r.cachedTokens ?? 0) > 0, preflight_ok: true, preflight_warnings: null, preflight_augmented: false,
    // Which builder step this was — its own column, NOT a warning (it once was,
    // and the Coach Health widget counted every build call as a problem).
    task,
    latency_ms: ms, status: r.error ? 'error' : r.finishReason === 'length' ? 'partial' : 'ok',
    error_message: r.error ?? null, plan_modified: false,
  }).catch(() => {});
  return { ...r, ms };
}
