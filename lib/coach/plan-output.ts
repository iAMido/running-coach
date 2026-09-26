/**
 * Turning a model's plan output into something safe to save — or refusing to.
 *
 * ## The bug this replaces
 *
 * Both generate routes did this on a parse failure:
 *
 *     planJson = { raw_response: text }      // then...
 *     UPDATE training_plans SET status='completed' WHERE status='active'
 *     INSERT the { raw_response } blob as the new ACTIVE plan
 *
 * So a failed generation did not merely fail — it retired the athlete's
 * working plan and replaced it with an unrenderable blob. Nothing reported it
 * as an error. It became reachable in practice on 2026-09-26, when adding
 * strength sessions pushed a 12-week plan past the 16,000-token output cap and
 * the response was cut off mid-JSON at week 10.
 *
 * `parsePlanOutput` now returns a verdict, and callers save ONLY on `ok`.
 * An incomplete plan is an error the athlete sees; the existing plan is
 * untouched.
 */

import { expandStrengthRefs, type ExpansionResult } from '@/lib/coach/plan-strength';

/**
 * Output-token ceiling for a plan of `weeks` weeks.
 *
 * Measured: ~1,600 output tokens per plan-week with strength written inline,
 * and JSON tokenises densely (~2.5 characters per token — 39,837 characters
 * came to exactly 16,000 tokens). 2,000/week plus a fixed allowance for the
 * header and strength library leaves room for a verbose week.
 *
 * It is a CEILING, not a target: the model stops when the plan is complete,
 * so a generous cap costs nothing on an ordinary plan. Bounded at 64,000 —
 * half the model's 128,000 limit — because a plan that genuinely needs more
 * would also take longer than a request can reasonably wait for.
 */
export function planOutputTokenBudget(weeks: number): number {
  const w = Math.max(1, Math.min(52, Math.round(weeks)));
  return Math.min(64_000, 4_000 + w * 2_000);
}

export type PlanParseResult =
  | { ok: true; plan: Record<string, unknown>; strength: ExpansionResult }
  | { ok: false; reason: 'truncated' | 'unparseable' | 'incomplete'; message: string; weeksReturned: number | null };

/** First JSON object in a model response, fenced or bare. Throws when there is none. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenced) return JSON.parse(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('no JSON object in the response');
  return JSON.parse(text.slice(first, last + 1));
}

/**
 * Parse, validate completeness, and expand strength references.
 *
 * `finishReason` is available on the non-streaming path; the streaming path
 * does not receive it, so completeness is ALSO checked structurally — a plan
 * with fewer weeks than requested is incomplete however it ended.
 */
export function parsePlanOutput(
  text: string,
  opts: { expectedWeeks: number; finishReason?: string | null },
): PlanParseResult {
  const truncated = opts.finishReason === 'length';

  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (err) {
    const weeksSeen = (text.match(/"week_number"\s*:\s*\d+/g) ?? []).length;
    return {
      ok: false,
      // Truncated JSON never parses, so a parse failure on a long response is
      // almost always the cap even when the stream could not say so.
      reason: truncated || weeksSeen > 0 ? 'truncated' : 'unparseable',
      weeksReturned: weeksSeen || null,
      message: truncated || weeksSeen > 0
        ? `The plan was cut off after ${weeksSeen} of ${opts.expectedWeeks} weeks — it exceeded the length the coach can write in one response. Nothing was saved; your current plan is unchanged. Try fewer weeks.`
        : `The coach's response could not be read as a plan (${err instanceof Error ? err.message : 'parse error'}). Nothing was saved; your current plan is unchanged.`,
    };
  }

  const plan = parsed as Record<string, unknown>;
  const weeks = Array.isArray(plan.weeks) ? plan.weeks : null;
  if (!weeks || weeks.length === 0) {
    return {
      ok: false, reason: 'unparseable', weeksReturned: 0,
      message: 'The coach returned no weeks. Nothing was saved; your current plan is unchanged.',
    };
  }
  if (truncated || weeks.length < opts.expectedWeeks) {
    return {
      ok: false, reason: truncated ? 'truncated' : 'incomplete', weeksReturned: weeks.length,
      message: `The plan came back with ${weeks.length} of ${opts.expectedWeeks} weeks. Nothing was saved; your current plan is unchanged.`,
    };
  }

  const strength = expandStrengthRefs(plan as Parameters<typeof expandStrengthRefs>[0]);
  return { ok: true, plan, strength };
}
