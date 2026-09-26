/**
 * Where the athlete is in the season, and whether the current phase is due.
 *
 * Pure. The season PLANS phase lengths; `phase_progress` records what actually
 * happened — when a phase really started (it is built when due, not all at
 * once) and how many weeks it was extended. Everything here reads actual dates
 * first and falls back to the plan, so a season that has drifted still reports
 * the truth.
 *
 * ## When is a phase "due"? (the athlete's rule, 2026-09-27)
 *
 * In its LAST 2 WEEKS, or earlier if every KPI is already met. Two weeks is
 * time to build and read the next phase before it starts. The app only
 * RECOMMENDS; a phase never advances until the athlete builds the next one.
 */

import type { MacroPhase, MacroPlan, PhaseProgress } from '@/lib/coach/macro-plan';
import type { KpiStatus } from '@/lib/coach/phase-kpis';

const DAY = 86_400_000;
export const DUE_WEEKS_LEFT = 2;

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

/** Progress rows for every phase — defaults for seasons created before tracking. */
export function progressOf(macro: Pick<MacroPlan, 'phases' | 'phase_progress'>): PhaseProgress[] {
  return macro.phases.map((p) => macro.phase_progress?.find((x) => x.phase_number === p.phase_number) ?? {
    phase_number: p.phase_number, status: 'planned', start_date: null, extension_weeks: 0, plan_ids: [], ended_on: null,
  });
}

export interface TimelineEntry {
  phase: MacroPhase;
  progress: PhaseProgress;
  /** Actual start when built, otherwise projected from the phases before it. */
  start: string;
  /** Last day (Saturday) including any extension. */
  end: string;
  weeks: number;
  projected: boolean;
}

/**
 * Every phase's dates. An extension or a late start pushes every later phase,
 * which is exactly what `raceSlackWeeks` then reports.
 */
export function timelineOf(macro: Pick<MacroPlan, 'phases' | 'phase_progress' | 'start_date' | 'created_at'>): TimelineEntry[] {
  const progress = progressOf(macro);
  let cursor = macro.start_date ?? macro.created_at.slice(0, 10);
  return macro.phases.map((phase, i) => {
    const pr = progress[i];
    const start = pr.start_date ?? cursor;
    const weeks = phase.weeks + (pr.extension_weeks ?? 0);
    const end = addDays(start, weeks * 7 - 1);
    cursor = addDays(end, 1);
    return { phase, progress: pr, start, end, weeks, projected: !pr.start_date };
  });
}

/**
 * Weeks between the season's projected end and race day. Negative means the
 * season now runs PAST the race — an extension has eaten into the taper.
 */
export function raceSlackWeeks(macro: Pick<MacroPlan, 'phases' | 'phase_progress' | 'start_date' | 'created_at' | 'race_date'>): number | null {
  if (!macro.race_date) return null;
  const t = timelineOf(macro);
  if (t.length === 0) return null;
  return Math.floor(daysBetween(t[t.length - 1].end, macro.race_date) / 7);
}

export interface CurrentPhase {
  entry: TimelineEntry;
  /** 1-based week of the phase today; null when the season has not started. */
  weekOfPhase: number | null;
  /** Weeks left including the current one. */
  weeksLeft: number | null;
  /** True when a training plan was built for this phase; false = inferred from the calendar. */
  built: boolean;
}

/**
 * The phase the athlete is in today. An ACTIVE progress row wins (it was
 * built, so its start is real); otherwise the calendar decides. Before any
 * phase is built this is phase 1 with weekOfPhase null — "not started".
 */
export function currentPhase(
  macro: Pick<MacroPlan, 'phases' | 'phase_progress' | 'start_date' | 'created_at'>,
  today: string,
): CurrentPhase | null {
  const t = timelineOf(macro);
  if (t.length === 0) return null;
  const active = t.find((e) => e.progress.status === 'active');
  const nothingBuilt = t.every((e) => e.progress.status === 'planned' && e.progress.plan_ids.length === 0);
  const tracked = !!macro.phase_progress;
  const entry = active
    ?? (tracked && nothingBuilt ? t[0] : t.find((e) => today >= e.start && today <= e.end))
    ?? (today < t[0].start ? t[0] : t[t.length - 1]);
  if (tracked && nothingBuilt && !active) return { entry, weekOfPhase: null, weeksLeft: null, built: false };
  const d = daysBetween(entry.start, today);
  if (d < 0) return { entry, weekOfPhase: null, weeksLeft: null, built: entry.progress.plan_ids.length > 0 };
  const weekOfPhase = Math.floor(d / 7) + 1;
  return { entry, weekOfPhase, weeksLeft: entry.weeks - weekOfPhase + 1, built: entry.progress.plan_ids.length > 0 };
}

export type Recommendation =
  | { kind: 'not_started'; message: string }
  | { kind: 'on_track'; message: string }
  | { kind: 'build_next'; message: string }
  | { kind: 'advance_with_gap'; message: string; gaps: string[] }
  | { kind: 'extend'; message: string; weeks: 2 | 3; eatsTaper: boolean }
  | { kind: 'season_end'; message: string };

/**
 * What to do about the current phase.
 *
 * - Not in its last 2 weeks and not every KPI met → on track (nothing to decide).
 * - Every measurable KPI met → build the next phase.
 * - One KPI short but close (within 15%) or improving, readiness not REST →
 *   advance, carrying the gap into the next phase's brief as a must-have.
 * - Otherwise → extend 2 weeks (small gaps) or 3 — unless that would push the
 *   season past race day, in which case advancing with the gaps is the honest
 *   recommendation and the message says what extending would cost.
 *
 * A KPI with no measurement is neither met nor missed; it is named, never
 * counted as a pass.
 */
export function recommend(
  current: CurrentPhase,
  statuses: KpiStatus[],
  opts: { isLastPhase: boolean; readiness: 'GO' | 'EASY' | 'REST' | null; raceSlackWeeks: number | null },
): Recommendation {
  const name = current.entry.phase.name;
  if (current.weekOfPhase === null) {
    return { kind: 'not_started', message: `${name} has not started. Build it to begin the season.` };
  }
  const measured = statuses.filter((s) => s.current !== null);
  const unmeasured = statuses.filter((s) => s.current === null).map((s) => s.kpi.label);
  const missed = measured.filter((s) => !s.met);
  const allMet = measured.length > 0 && missed.length === 0;
  const due = (current.weeksLeft ?? Infinity) <= DUE_WEEKS_LEFT || allMet;
  const unmeasuredNote = unmeasured.length ? ` Not measurable yet: ${unmeasured.join('; ')}.` : '';

  if (!due) {
    return { kind: 'on_track', message: `Week ${current.weekOfPhase} of ${current.entry.weeks} in ${name}. ${measured.length - missed.length} of ${measured.length} KPIs met so far.${unmeasuredNote}` };
  }
  if (opts.isLastPhase) {
    return { kind: 'season_end', message: `${name} is the final phase${allMet ? ' and its KPIs are met' : ''}. Race day is the next step.` };
  }
  if (allMet) {
    return { kind: 'build_next', message: `Every measured KPI of ${name} is met. Build the next phase.${unmeasuredNote}` };
  }

  const gapOf = (s: KpiStatus) => (s.current === null || s.kpi.target === 0 ? 1 : Math.abs(s.kpi.target - s.current) / Math.abs(s.kpi.target));
  const close = (s: KpiStatus) => gapOf(s) <= 0.15 || s.trend === (s.kpi.comparator === 'gte' ? 'up' : 'down');
  const gaps = missed.map((s) => `${s.kpi.label} (now ${s.current}, target ${s.kpi.target})`);

  const canCarry = missed.length === 1 && close(missed[0]) && opts.readiness !== 'REST';
  if (canCarry) {
    return { kind: 'advance_with_gap', gaps, message: `${name} is nearly there — ${gaps[0]}. Advance and carry it into the next phase as a must-have.${unmeasuredNote}` };
  }
  const weeks: 2 | 3 = missed.length <= 2 && missed.every((s) => gapOf(s) <= 0.25) ? 2 : 3;
  const eatsTaper = opts.raceSlackWeeks !== null && opts.raceSlackWeeks < weeks;
  if (eatsTaper) {
    return {
      kind: 'advance_with_gap', gaps,
      message: `${name} missed ${missed.length} KPI(s): ${gaps.join('; ')}. Extending ${weeks} weeks would push the season past race day (only ${Math.max(0, opts.raceSlackWeeks!)} week(s) of slack), so advance and carry the gaps.${unmeasuredNote}`,
    };
  }
  return {
    kind: 'extend', weeks, eatsTaper,
    message: `${name} missed ${missed.length} KPI(s): ${gaps.join('; ')}${opts.readiness === 'REST' ? ' — and readiness says REST' : ''}. Extend ${weeks} weeks before moving on.${opts.raceSlackWeeks !== null ? ` That leaves ${opts.raceSlackWeeks - weeks} week(s) of slack before race day.` : ''}${unmeasuredNote}`,
  };
}
