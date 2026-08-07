/**
 * Push one plan week to the athlete's intervals.icu calendar.
 *
 * ## Push means REPLACE, not append
 *
 * `POST /events` happily creates duplicates, and two identical workouts on
 * Friday is a worse failure than none — on the watch there is no way to tell
 * which is real. Worse, `plans/adjust` can rewrite a week after it has been
 * pushed, which would leave stale sessions on the calendar forever.
 *
 * So a push reads the existing events for the week, deletes the ones this app
 * created, and writes the current plan fresh. Idempotent by construction: the
 * second click produces the same calendar as the first.
 *
 * ## Only deleting what we recognise
 *
 * Deleting by date range alone would destroy workouts the athlete built by hand
 * in intervals.icu. Every pushed event therefore carries a marker line in its
 * description, and only events carrying it are ever deleted.
 *
 * The marker is a plain trailer line. Verified live (2026-08-07) that the
 * workout parser ignores it: a description of `- 10m 65-75% HR` plus a marker
 * line still produced exactly one step.
 *
 * ## The 7-day horizon is a delay, not a failure
 *
 * intervals.icu only syncs about a week ahead to the watch. Pushing a further
 * week SUCCEEDS — the event exists on the calendar and reaches the device once
 * it comes inside the window. Callers should say so rather than report an error.
 */

import type { PlanWeek, TrainingPlan, Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';
import type { IntervalsClient } from '@/lib/intervals/client';
import { planWorkoutToDescription } from '@/lib/intervals/workout-format';

/** Prefix identifying an event this app created. Never change it casually — older events carry it. */
export const PUSH_MARKER = 'RunCoach';

/** How far ahead intervals.icu syncs to the watch. */
export const WATCH_HORIZON_DAYS = 7;

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildMarker(planId: string, weekNumber: number): string {
  return `${PUSH_MARKER}:${planId}:w${weekNumber}`;
}

/** True when this app wrote the event. Anything else is the athlete's own. */
export function isAppCreated(description: string | null | undefined): boolean {
  return typeof description === 'string' && description.includes(`${PUSH_MARKER}:`);
}

/**
 * Calendar arithmetic on a date-only string. No timezone is involved — a plan
 * day is a calendar day, so parsing as UTC and adding whole days is exact.
 */
export function addDays(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`Unparseable date: ${dateStr}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * First calendar day of a plan week.
 *
 * Week 1 begins on the SUNDAY OF THE WEEK CONTAINING `start_date`, not on
 * `start_date` itself — that is what `calculateCurrentWeek` does, and the two
 * must agree or a push lands on different dates than the week the app is
 * showing. This plan starts 2026-06-13 (a Saturday), so week 1 begins
 * 2026-06-07 and week 9 begins 2026-08-02, which is the week containing today.
 * Using `start_date` verbatim put week 9 at 2026-08-08 — six days out.
 */
export function weekStartDate(plan: Pick<TrainingPlan, 'start_date'>, weekNumber: number): string | null {
  if (!plan.start_date) return null;
  const startStr = plan.start_date.slice(0, 10);
  const ms = Date.parse(`${startStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Date-only arithmetic in UTC: no timezone is involved in a calendar day.
  const week1Sunday = addDays(startStr, -new Date(ms).getUTCDay());
  return addDays(week1Sunday, (weekNumber - 1) * 7);
}

export interface PushRow {
  day: string;
  date: string;
  workoutName: string;
  /** Null when the day cannot be pushed (rest day, unparseable). */
  description: string | null;
  minutes: number | null;
  bpmLow: number | null;
  bpmHigh: number | null;
  pctLabel: string | null;
  notes: string[];
  /** Why it is being skipped, when it is. */
  skipReason?: string;
  /** True when the date sits beyond the watch sync horizon. */
  beyondWatchHorizon: boolean;
}

/**
 * Translate a week into rows, without writing anything.
 *
 * Resolved bpm is carried alongside the percentage because that is the number
 * the athlete recognises — it is what makes the translation checkable before it
 * becomes a session he actually runs.
 */
export function previewWeek(
  plan: TrainingPlan,
  week: PlanWeek,
  weekNumber: number,
  bands: ZoneBands,
  maxHr: number,
  today: string,
): PushRow[] {
  const start = weekStartDate(plan, weekNumber);
  if (!start) return [];

  const horizonEnd = addDays(today, WATCH_HORIZON_DAYS);
  const rows: PushRow[] = [];

  for (let i = 0; i < DAY_ORDER.length; i++) {
    const day = DAY_ORDER[i];
    const workout = (week.workouts as Record<string, Workout> | undefined)?.[day];
    const date = addDays(start, i);
    const beyondWatchHorizon = date > horizonEnd;

    if (!workout || !workout.type || workout.type === '—') {
      continue; // rest day — nothing to push, and nothing worth showing
    }

    const translated = planWorkoutToDescription(workout, bands, maxHr);
    if (!translated) {
      rows.push({
        day, date, workoutName: workout.type,
        description: null, minutes: null, bpmLow: null, bpmHigh: null, pctLabel: null,
        notes: [],
        skipReason: 'no usable HR target or duration in the plan',
        beyondWatchHorizon,
      });
      continue;
    }

    const pct = /- \d+m ([\d.]+-[\d.]+% HR)/.exec(translated.description)?.[1] ?? null;
    rows.push({
      day, date, workoutName: workout.type,
      description: translated.description,
      minutes: translated.minutes,
      bpmLow: translated.bpmLow,
      bpmHigh: translated.bpmHigh,
      pctLabel: pct,
      notes: translated.notes,
      beyondWatchHorizon,
    });
  }

  return rows;
}

export interface PushResult {
  created: number;
  replaced: number;
  skipped: number;
  beyondHorizon: number;
  rows: PushRow[];
  errors: string[];
}

interface CalendarEvent {
  id: number | string;
  start_date_local?: string;
  description?: string | null;
}

/**
 * Write the week, replacing anything this app previously wrote for those dates.
 *
 * Deletes first so a failure part-way leaves no duplicates — worst case the
 * week is partially written, which the next push corrects.
 */
export async function pushWeek(
  client: IntervalsClient,
  plan: TrainingPlan,
  week: PlanWeek,
  weekNumber: number,
  bands: ZoneBands,
  maxHr: number,
  today: string,
): Promise<PushResult> {
  const rows = previewWeek(plan, week, weekNumber, bands, maxHr, today);
  const result: PushResult = { created: 0, replaced: 0, skipped: 0, beyondHorizon: 0, rows, errors: [] };

  const start = weekStartDate(plan, weekNumber);
  if (!start) {
    result.errors.push('Plan has no start_date, so its week dates cannot be resolved.');
    return result;
  }
  const end = addDays(start, 6);

  // Remove our own previous events for this range. Anything the athlete made by
  // hand is left alone.
  try {
    const existing = (await client.getEvents(start, end)) as CalendarEvent[];
    for (const event of existing) {
      if (!isAppCreated(event.description)) continue;
      try {
        await client.deleteEvent(event.id);
        result.replaced++;
      } catch (err) {
        result.errors.push(`delete ${event.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Could not read existing events: ${err instanceof Error ? err.message : String(err)}`);
    return result; // refuse to write blind — that is how duplicates happen
  }

  const marker = buildMarker(plan.id, weekNumber);

  for (const row of rows) {
    if (!row.description) {
      result.skipped++;
      continue;
    }
    if (row.beyondWatchHorizon) result.beyondHorizon++;

    const notes = row.notes.length ? `\n\n${row.notes.join('\n')}` : '';
    try {
      await client.createWorkoutEvent({
        startDateLocal: `${row.date}T00:00:00`,
        name: row.workoutName,
        description: `${row.description}${notes}\n\n${marker}`,
        movingTimeSec: row.minutes ? Math.round(row.minutes * 60) : undefined,
      });
      result.created++;
    } catch (err) {
      result.errors.push(`${row.date} ${row.workoutName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
