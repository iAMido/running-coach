/**
 * Strength sessions are generated ONCE and referenced by key.
 *
 * ## Why
 *
 * Measured 2026-09-26: with strength written out in full on every day that
 * carries it, a 12-week plan hit the 16,000-token output cap at week 10 and
 * was cut off mid-JSON (finish_reason "length"). Across the 36 workouts that
 * did arrive, strength blocks were 27% of the output and indoor alternatives
 * another 24%. And the strength was highly repetitive — which is exactly how
 * the expert plans are built: Carmel-Kinneret repeats "Trail strength:
 * foundation" through the whole base phase, then switches to "single-leg and
 * eccentric". The model was re-emitting ~950 characters for a session it had
 * already written.
 *
 * So the model now defines each distinct session once in a top-level
 * `strength_sessions` map and a day carries `"strength": "<key>"`. The server
 * expands references into full objects BEFORE the plan is saved, so every
 * downstream reader — the workout card, the adjust route, the watch push —
 * sees a complete object exactly as before. Only the model's output shrinks.
 */

import type { PlannedStrength } from '@/lib/db/types';

export interface ExpansionResult {
  expanded: number;
  /** References to keys the library did not define. Dropped, never rendered. */
  dangling: string[];
}

type AnyWorkout = { strength?: unknown } & Record<string, unknown>;
type AnyWeek = { workouts?: Record<string, AnyWorkout> } & Record<string, unknown>;
type AnyPlan = { weeks?: AnyWeek[]; strength_sessions?: Record<string, unknown> } & Record<string, unknown>;

function isStrengthObject(v: unknown): v is PlannedStrength {
  return !!v && typeof v === 'object' && Array.isArray((v as PlannedStrength).exercises);
}

/**
 * Replace every `"strength": "<key>"` with a copy of the library entry.
 * Mutates and returns the plan.
 *
 * A reference to an undefined key is DROPPED and reported, not rendered as a
 * broken session — "strength: undefined" on a workout card would look like a
 * prescription. Inline objects (older plans, or a model that ignored the
 * library) pass through untouched, so this is safe on any plan.
 *
 * `library` can be supplied separately: an adjustment's output may reference
 * sessions defined in the ORIGINAL plan rather than in its own output.
 */
export function expandStrengthRefs(
  plan: AnyPlan,
  library: Record<string, unknown> | undefined = plan.strength_sessions,
): ExpansionResult {
  const result: ExpansionResult = { expanded: 0, dangling: [] };
  for (const week of plan.weeks ?? []) {
    for (const workout of Object.values(week.workouts ?? {})) {
      if (!workout || typeof workout.strength !== 'string') continue;
      const key = workout.strength;
      const entry = library?.[key];
      if (isStrengthObject(entry)) {
        // A copy, so one day's later edit cannot silently change another's.
        workout.strength = JSON.parse(JSON.stringify(entry));
        result.expanded++;
      } else {
        delete workout.strength;
        result.dangling.push(key);
      }
    }
  }
  return result;
}
