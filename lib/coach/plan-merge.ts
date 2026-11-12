/**
 * Merging a model-rewritten plan week into the stored one (2026-11-12). Pure.
 *
 * The chat's plan-edit mode asks the model for whole weeks and used to save
 * them as given. On 2026-11-10 it did that twice for a question that was not
 * a change at all ("what needs to change on the next run analysis?") — the
 * model restated week 1 with "No changes" and the restatement dropped both
 * strength sessions and every watch step. Two rules now:
 *
 *   1. A week whose sessions did not change (same days, same type / distance /
 *      duration / target HR / target pace) is NOT written. Rewording a
 *      description is not a change.
 *   2. What the model omits is carried from the stored session it came from —
 *      strength, watch steps, climb, indoor alternative, source. A session the
 *      model MOVED to another day takes its own fields with it.
 */

import type { PlanWeek, Workout } from '@/lib/db/types';

const CORE = ['type', 'distance', 'duration', 'target_hr', 'target_pace'] as const;

function isRest(w: Workout | null | undefined): boolean {
  return !w || !w.type || w.type === '—' || /^rest\b/i.test(w.type);
}

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameSession(a: Workout, b: Workout): boolean {
  return CORE.every((k) => norm(a[k]) === norm(b[k]));
}

function sessions(week: PlanWeek | undefined): Record<string, Workout> {
  const out: Record<string, Workout> = {};
  for (const [day, w] of Object.entries(week?.workouts ?? {})) if (!isRest(w)) out[day] = w;
  return out;
}

/** True when any day gained, lost or changed a session. */
export function weekChanged(before: PlanWeek | undefined, after: PlanWeek): boolean {
  const a = sessions(before);
  const b = sessions(after);
  const days = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const d of days) {
    if (!a[d] || !b[d] || !sameSession(a[d], b[d])) return true;
  }
  return false;
}

/** The stored session `w` most likely came from: same day and type, else the same type moved from a day it left. */
function sourceOf(day: string, w: Workout, before: Record<string, Workout>, after: Record<string, Workout>): Workout | undefined {
  if (before[day] && before[day].type === w.type) return before[day];
  for (const [d, old] of Object.entries(before)) {
    if (d !== day && old.type === w.type && (!after[d] || after[d].type !== old.type)) return old;
  }
  return undefined;
}

/** Fill what the model left out from the session each day came from. */
export function mergeAdjustedWeek(before: PlanWeek | undefined, after: PlanWeek): PlanWeek {
  if (!before) return after;
  const old = sessions(before);
  const next = sessions(after);
  const workouts: Record<string, Workout> = {};
  for (const [day, w] of Object.entries(after.workouts ?? {})) {
    if (isRest(w)) { workouts[day] = w; continue; }
    const src = sourceOf(day, w, old, next);
    const merged: Workout = { ...w };
    if (src) {
      if (merged.strength == null && src.strength != null) merged.strength = src.strength;
      if (!merged.steps?.length && src.steps?.length && norm(src.duration) === norm(w.duration)) merged.steps = src.steps;
      if (merged.elevation_gain_m == null && src.elevation_gain_m != null) merged.elevation_gain_m = src.elevation_gain_m;
      if (merged.indoor_alternative == null && src.indoor_alternative != null) merged.indoor_alternative = src.indoor_alternative;
      if (merged.source == null && src.source != null) merged.source = src.source;
    }
    workouts[day] = merged;
  }
  return {
    ...after,
    total_elevation_gain_m: after.total_elevation_gain_m ?? before.total_elevation_gain_m ?? null,
    workouts,
  };
}
