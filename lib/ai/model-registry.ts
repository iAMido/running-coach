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
   *
   * STAYS ON OPUS 4.7 — Opus 5.5 was tested and rejected on 2026-09-26.
   * Its reasoning cannot be disabled and it treats the thinking budget as a
   * hint: on the 12-week verification plan it took 274 s with a 6,000
   * budget, and with a 1,024 budget it thought for 14,241 tokens anyway and
   * was cut off at week 10 of 12 after 265 s. The function limit is 300 s.
   * Opus 4.7 wrote the same plan complete in 149 s. Revisit only with a
   * measured run of scripts/verify-plan-generation.ts --model <id>.
   * This key also drives the season macro plan and the Saturday proposal.
   */
  plan_generation:      'anthropic/claude-opus-4.7',

  /**
   * Staged plan builder (lib/coach/plan-builder). The head coach — outline
   * and the "does it all fit" review — writes little and reasons a lot, which
   * is exactly where Opus 5.5's unbounded thinking is an asset rather than
   * the time bomb it was for single-call generation. Phase writers produce
   * the bulk JSON against the outline; Opus 4.7 wrote complete, well-formed
   * plan JSON in every measured run.
   */
  plan_outline:         'anthropic/claude-opus-5.5',
  plan_writer:          'anthropic/claude-opus-4.7',
  plan_review:          'anthropic/claude-opus-5.5',
  // Adjustment is a smaller, bounded task than generation — at most a 4-week
  // window against an existing plan. Named here rather than left to
  // callOpenRouter's default, so the choice is visible and deliberate instead
  // of being whatever the library happens to fall back to.
  plan_adjust:          'anthropic/claude-sonnet-5',

  /**
   * Weekly review — substantial reasoning over the week's runs,
   * intervals, lap data, planned-vs-actual, zones and grade-adjusted pace.
   * Moved from Sonnet to Opus on 2026-09-26: this is judgement over dense
   * data, closer to plan building than to chat, and at ~52 runs a year the
   * difference is roughly $6/year.
   */
  weekly_review:        'anthropic/claude-opus-5.5',

  /**
   * Plan modification in chat — needs structured JSON output and
   * accuracy on individual workout edits.
   */
  plan_modification:    'anthropic/claude-sonnet-5',

  /**
   * Default chat — for non-trivial questions. The complexity router
   * (see lib/ai/router.ts) picks between chat_quick and chat_default
   * via a cheap Haiku classification call.
   */
  chat_default:         'anthropic/claude-sonnet-5',

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
  // Grok 4 was deprecated by xAI in 2026 (→ 4.3); 4.3 → 4.7 on 2026-09-26. Still
  // a different model family from the Claude coaches, which is the point.
  grocky:               'x-ai/grok-4.7',
} as const;

export type ModelTaskKey = keyof typeof MODEL_FOR;

/**
 * Resolve a task key to a model id. Falls back to chat_default if the
 * caller asks for an unknown task — defensive, never throws.
 */
export function modelFor(task: ModelTaskKey): string {
  return MODEL_FOR[task] ?? MODEL_FOR.chat_default;
}

/**
 * Thinking budget (tokens, on top of the visible-output limit) for tasks
 * routed to a reasoning model. Tasks not listed get the model's default in
 * lib/ai/openrouter.ts (REASONING_POLICY). Reasoning on Opus 5.5 and
 * Grok 4.7 cannot be disabled, only bounded.
 *
 * Plan generation deliberately has NO entry: it runs on Opus 4.7, where a
 * budget here would switch thinking ON and push a ~150 s request toward the
 * 300 s limit. The call sites still pass REASONING_FOR.plan_generation so a
 * future model change needs only this table.
 *
 * The weekly review's budget is generous because Opus 5.5 overshoots it
 * (4,274 used against 4,000 in testing) and the thinking shares max_tokens
 * with the answer. Measured review: 68-82 s, well inside the limit.
 */
export const REASONING_FOR: Partial<Record<ModelTaskKey, number>> = {
  weekly_review:   8_000,
  // Headroom for the head coach. Opus 5.5 overshoots budgets (14k thinking
  // was measured against a 1k budget), so these are sized to what it
  // actually uses, not to what we would like it to use.
  plan_outline:    16_000,
  plan_review:     12_000,
};

/**
 * Visible-answer limit for the weekly review. Was 2,000 from the app's first
 * commit; measured 2026-09-26, the review was being CUT OFF mid-sentence at
 * exactly 2,000 tokens on the production model (Sonnet 4.6) — the prompt now
 * carries laps, zones, GAP, decoupling and the scorecard, and the model
 * uses them. It is a ceiling, not a target: a finished review stops early.
 */
export const WEEKLY_REVIEW_MAX_TOKENS = 5_000;
