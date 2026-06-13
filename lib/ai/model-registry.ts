/**
 * Per-task model registry.
 *
 * Picks the right model for the size of the task. Plan generation (rare,
 * deep, multi-constraint) gets Opus. Weekly review / long chat / plan
 * modification (substantial reasoning, structured output) get Sonnet.
 * Classification + critic + quick chat (small task, cost-sensitive,
 * latency-sensitive) get Haiku. Grocky stays on Grok for voice diversity.
 *
 * The user explicitly chose minimum 4.7 across the Anthropic line, with
 * Opus for plan generation specifically because they generate plans only
 * every 2-3 months and want depth on methodology + per-workout structure.
 *
 * Caller pattern:
 *   import { MODEL_FOR } from '@/lib/ai/model-registry';
 *   await callOpenRouter(messages, { apiKey, model: MODEL_FOR.weekly_review, ... });
 *
 * Telemetry: coach_calls.model already stores the chosen model, so the
 * supervisor's weekly health audit can break stats out by task tier.
 */

export const MODEL_FOR = {
  /**
   * Plan generation — runs maybe 4-6 times per year. Multi-constraint:
   * methodology + phase progression + per-workout structure + recovery
   * patterns + training-day anchors + long-term goal alignment + injury
   * history. Opus's deeper reasoning chain catches cross-constraints
   * that Sonnet sometimes blurs. ~5× the per-call cost, but per-year
   * cost is still <$10.
   */
  plan_generation:      'anthropic/claude-opus-4.7',

  /**
   * Weekly review — substantial reasoning over the week's runs,
   * intervals, lap data, planned-vs-actual. Runs ~52/year. Sonnet is
   * plenty.
   */
  weekly_review:        'anthropic/claude-sonnet-4.6',

  /**
   * Plan modification in chat — needs structured JSON output and
   * accuracy on individual workout edits.
   */
  plan_modification:    'anthropic/claude-sonnet-4.6',

  /**
   * Default chat — for non-trivial questions. The complexity router
   * (see lib/ai/router.ts) picks between chat_quick and chat_default
   * via a cheap Haiku classification call.
   */
  chat_default:         'anthropic/claude-sonnet-4.6',

  /**
   * Quick chat — "should I run today?", "is my HR too high?" etc.
   * Fast + cheap; Haiku's accuracy ceiling is fine for these.
   */
  chat_quick:           'anthropic/claude-haiku-4.5',

  /**
   * Post-flight critic. Cheap grading task; was already Haiku on the
   * supervisor side.
   */
  critic:               'anthropic/claude-haiku-4.5',

  /**
   * Query classifier — replaces the keyword regex with a small Haiku
   * call. Classification is a simple labelling task; budget-hygiene
   * principle says don't spend more on routing than on the answer.
   */
  classification:       'anthropic/claude-haiku-4.5',

  /**
   * Grocky (second opinion). Different model family for voice diversity.
   */
  // Grok 4 was deprecated by xAI in late 2026; switched to 4.3 per the
  // OpenRouter migration notice.
  grocky:               'x-ai/grok-4.3',
} as const;

export type ModelTaskKey = keyof typeof MODEL_FOR;

/**
 * Resolve a task key to a model id. Falls back to chat_default if the
 * caller asks for an unknown task — defensive, never throws.
 */
export function modelFor(task: ModelTaskKey): string {
  return MODEL_FOR[task] ?? MODEL_FOR.chat_default;
}
