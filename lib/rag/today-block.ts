/**
 * "What day is it" for the coach (2026-11-12). Pure.
 *
 * The chat was never told today's date. On Thursday 12 Nov the athlete asked
 * to move yesterday's session to today; the coach assumed it was Monday 9 Nov
 * (the date of his most recent run) and answered about the wrong days. This
 * block states today, yesterday and tomorrow in Israel time, with each day's
 * planned session and what was actually run, so relative days resolve against
 * the calendar and a missed session is visible as missed.
 */

import { plannedWorkoutForRunDate } from '@/lib/ai/run-reaction';
import { USER_TIMEZONE, userDateStr } from '@/lib/utils/user-time';
import type { TrainingPlan, Workout } from '@/lib/db/types';

export interface DayRun {
  date: string;
  distance_km?: number | null;
  duration_min?: number | null;
  run_type?: string | null;
  workout_name?: string | null;
}

const DAY_MS = 24 * 3600 * 1000;

export function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { timeZone: USER_TIMEZONE, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function isRestDay(w: Workout | null): boolean {
  return !w || !w.type || w.type === '—' || /^rest\b/i.test(w.type);
}

function plannedText(plan: TrainingPlan | null, d: Date): string {
  if (!plan) return 'no active plan';
  const { workout } = plannedWorkoutForRunDate(plan, d);
  if (!plan.plan_json?.weeks || !plan.start_date) return 'no active plan';
  if (isRestDay(workout)) return 'rest day (or outside the plan)';
  const w = workout!;
  return [w.type, w.distance, w.duration, w.target_hr ? `HR ${w.target_hr}` : null].filter(Boolean).join(', ');
}

function doneText(runs: DayRun[], d: Date): string {
  const day = userDateStr(d);
  const done = runs.filter((r) => userDateStr(new Date(r.date)) === day);
  if (!done.length) return 'no run recorded';
  return done
    .map((r) => `${r.workout_name || r.run_type || 'run'} ${r.distance_km != null ? `${Number(r.distance_km).toFixed(1)} km` : ''}`.trim())
    .join(' + ');
}

export function formatTodayBlock(plan: TrainingPlan | null, runs: DayRun[], now: Date = new Date()): string {
  const yesterday = new Date(now.getTime() - DAY_MS);
  const tomorrow = new Date(now.getTime() + DAY_MS);
  const line = (label: string, d: Date, withDone: boolean) =>
    `- ${label} — ${dayLabel(d)}: planned ${plannedText(plan, d)}${withDone ? `; done: ${doneText(runs, d)}` : ''}`;
  return [
    '## Today',
    `Today is ${dayLabel(now)} (Israel time). Resolve "today", "yesterday" and "tomorrow" (היום / אתמול / מחר) against this date — never against the date of the most recent run.`,
    line('Yesterday', yesterday, true),
    line('Today', now, true),
    line('Tomorrow', tomorrow, false),
  ].join('\n');
}
