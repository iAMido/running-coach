/**
 * Structured workout steps in a plan — pure helpers shared by the plan
 * checker, the reviewer's compact rendering and plan adjust (2026-11-06).
 *
 * The steps are what reaches the watch as a real workout (warm-up, repeat
 * blocks, cool-down); see lib/intervals/workout-format.ts for the rendering
 * and the intervals.icu syntax it was probed against.
 */

import type { PlanStep, Workout } from '@/lib/db/types';
import { flatPlanSteps, parseDurationMinutes, planStepsSeconds } from '@/lib/intervals/workout-format';

export { flatPlanSteps, planStepsSeconds };

/** Steps vs the session's own duration: within this it is the same session. */
export const STEPS_DURATION_TOLERANCE = { warnPct: 0.10, errorPct: 0.20, minAbsMin: 4 };

function dur(s: PlanStep): string {
  if (typeof s.sec === 'number' && s.sec > 0) return s.sec % 60 === 0 ? `${s.sec / 60}m` : `${s.sec}s`;
  if (typeof s.min === 'number' && s.min > 0) return `${s.min}m`;
  return '?';
}

function one(s: PlanStep): string {
  const label = s.kind === 'warmup' ? 'WU' : s.kind === 'cooldown' ? 'CD' : s.kind === 'recovery' ? 'rec' : s.kind;
  return `${label} ${dur(s)}${s.hr ? ` ${s.hr}` : ''}`;
}

/** "WU 10m Z1-Z2 (115-135) · 6×(work 45s Z3-Z4 (150-165) / rec 90s) · CD 10m" */
export function describePlanSteps(steps: PlanStep[] | null | undefined): string {
  return (steps ?? []).filter(Boolean).map((s) =>
    s.kind === 'repeat' ? `${s.reps ?? '?'}×(${(s.steps ?? []).map(one).join(' / ')})` : one(s),
  ).join(' · ');
}

export interface StepsProblem {
  severity: 'error' | 'warn';
  message: string;
}

/**
 * Problems with one workout's steps. A run without steps is not a problem
 * here (older plans, and the push falls back to one steady step); steps that
 * do not add up to the session are, because the watch would run a different
 * session from the one the plan counts.
 */
export function checkWorkoutSteps(w: Workout): StepsProblem[] {
  const steps = w.steps;
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const out: StepsProblem[] = [];

  for (const s of steps) {
    if (s?.kind === 'repeat') {
      const reps = Math.round(Number(s.reps));
      if (!(reps >= 1) || !s.steps?.length) out.push({ severity: 'error', message: 'a "repeat" step needs "reps" and its own "steps".' });
      if (s.steps?.some((x) => x?.kind === 'repeat')) out.push({ severity: 'error', message: 'a repeat inside a repeat cannot reach the watch — flatten it.' });
    }
  }
  if (flatPlanSteps(steps).some((s) => s.kind !== 'repeat' && !(Number(s.sec) > 0) && !(Number(s.min) > 0))) {
    out.push({ severity: 'error', message: 'a step has no duration ("min" or "sec").' });
  }

  const planned = parseDurationMinutes(w.duration);
  const total = planStepsSeconds(steps) / 60;
  if (planned && total > 0) {
    const diff = Math.abs(total - planned);
    const pct = diff / planned;
    const t = STEPS_DURATION_TOLERANCE;
    if (diff > t.minAbsMin && pct > t.warnPct) {
      out.push({
        severity: pct > t.errorPct ? 'error' : 'warn',
        message: `steps add up to ${Math.round(total)} min but the session says ${w.duration} — make them agree.`,
      });
    }
  }
  return out;
}

/**
 * When an adjustment rewrites a workout without steps, keep the old steps only
 * if the session is still the same session (same type and duration). A
 * changed session must not inherit steps that describe the old one.
 */
export function carryForwardSteps(after: Workout, before: Workout | undefined): Workout {
  if (after.steps?.length || !before?.steps?.length) return after;
  if (after.type !== before.type || (after.duration ?? '') !== (before.duration ?? '')) return after;
  return { ...after, steps: before.steps };
}
