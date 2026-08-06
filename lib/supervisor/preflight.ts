/**
 * Pre-flight gate for AI coach calls.
 *
 * Cheap, deterministic, no LLM. Reads the assembled EnhancedContext (plus
 * any extras the caller has handy — like the actual plan or the runs for
 * the week being reviewed) and asserts a per-query-type coverage checklist.
 * On failure it either *blocks* the call or *warns* — and can inject a
 * short suffix into the system prompt asking the model to acknowledge the
 * missing piece rather than confabulate around it.
 *
 * Catches the silent failures that motivated this whole project: the
 * weekly review going out blind to the planned week, the coach answering
 * a question about today without seeing today's planned workout, plan
 * generation firing with zero book sources retrieved, etc.
 */

import type { EnhancedContext, QueryType } from '@/lib/rag/types';
import type { TrainingPlan, Run } from '@/lib/db/types';
import type { PreflightResult, PreflightWarning } from './types';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { nowInUserTz, userDateStr } from '@/lib/utils/user-time';

export interface PreflightInput {
  context: EnhancedContext;
  queryType: QueryType;
  /** Active plan (if loaded by the caller). */
  plan?: TrainingPlan | null;
  /** Actual runs for the period being analyzed (weekly review). */
  weekRuns?: Run[];
  /** For plan_modification: must be truthy. */
  hasActivePlan?: boolean;
  /**
   * `day` (YYYY-MM-DD) of the newest daily_wellness row, or null when there is
   * none. Undefined means the caller did not check, and no warning is raised —
   * "not looked at" and "confirmed stale" are different states.
   */
  latestWellnessDay?: string | null;
}

/** Beyond this, the recovery picture is too old to reason from. */
const WELLNESS_STALE_DAYS = 2;

const HARD_BLOCKERS = new Set<string>([
  'no_active_plan_for_modification',
]);

export function validateContext(input: PreflightInput): PreflightResult {
  const warnings: PreflightWarning[] = [];
  const augmentations: string[] = [];

  const { context, queryType, plan, weekRuns, hasActivePlan, latestWellnessDay } = input;
  const user = context.userContext;
  const coach = context.coachContext;
  const book = context.bookContext;

  // ── Always-on checks ─────────────────────────────────────────────────
  if (user.tokenCount < 200) {
    warnings.push({
      code: 'user_context_too_small',
      message: 'User context is unusually small — profile or recent activity may be missing.',
      severity: 'warn',
    });
  }
  // Recovery feed freshness. `undefined` means the caller did not look; only a
  // checked-and-stale feed warrants a warning, otherwise every route that does
  // not care about wellness would emit a false positive.
  if (latestWellnessDay !== undefined) {
    if (latestWellnessDay === null) {
      warnings.push({
        code: 'no_wellness_data',
        message: 'No recovery data (HRV, sleep, resting HR) has ever been synced.',
        severity: 'warn',
      });
      augmentations.push(
        'There is no HRV, sleep or resting-HR data available. Do not comment on the athlete\'s recovery state or infer it from training load — say it is unavailable if it is relevant.',
      );
    } else {
      const ageDays = Math.floor(
        (Date.parse(`${userDateStr()}T00:00:00Z`) - Date.parse(`${latestWellnessDay}T00:00:00Z`)) / 86_400_000,
      );
      if (ageDays > WELLNESS_STALE_DAYS) {
        warnings.push({
          code: 'stale_wellness_data',
          message: `Newest recovery data is ${ageDays} days old (${latestWellnessDay}).`,
          severity: 'warn',
        });
        augmentations.push(
          `The most recent HRV/sleep/resting-HR data is from ${latestWellnessDay}, ${ageDays} days ago. Treat any recovery claim as out of date and say so rather than presenting it as current.`,
        );
      }
    }
  }

  if (user.metadata.runsIncluded === 0 && queryType !== 'plan_generation') {
    warnings.push({
      code: 'no_recent_runs',
      message: 'No runs in the last 14 days. The coach has nothing recent to reason about.',
      severity: 'warn',
    });
    augmentations.push(
      'The athlete has no logged runs in the last 14 days. Acknowledge this gap before giving advice, and ask whether the athlete has been training or is returning from a break.',
    );
  }

  // ── Per-query checks ─────────────────────────────────────────────────
  switch (queryType) {
    case 'plan_review': {
      // Planned workouts for the review week
      const planHasCurrentWeek = !!(
        plan?.plan_json?.weeks &&
        planWeekForDate(plan, nowInUserTz())
      );
      if (!planHasCurrentWeek) {
        warnings.push({
          code: 'no_planned_week',
          message: 'No active plan covers the week being reviewed — planned-vs-actual comparison will be limited.',
          severity: 'warn',
        });
        augmentations.push(
          'No active training plan covers this week. Skip the planned-vs-actual comparison and focus on the actual runs.',
        );
      }
      if ((weekRuns?.length ?? 0) === 0) {
        warnings.push({
          code: 'review_no_runs',
          message: 'Weekly review requested but no runs were logged this week.',
          severity: 'warn',
        });
      }
      break;
    }

    case 'plan_generation': {
      if (book.sources.length === 0) {
        warnings.push({
          code: 'no_book_sources',
          message: 'Methodology retrieval returned no book sources. Plan will rely on the model\'s priors only.',
          severity: 'warn',
        });
      }
      if (coach.workoutsIncluded.length === 0) {
        warnings.push({
          code: 'no_coach_workouts',
          message: 'No historical coach workouts surfaced — plan won\'t reference athlete\'s familiar sessions.',
          severity: 'warn',
        });
      }
      break;
    }

    case 'daily_advice':
    case 'ask_coach':
    case 'grocky': {
      // Soft check: does the AI know what was planned for today?
      const todayPlan = plan ? plannedWorkoutForDate(plan, nowInUserTz()) : null;
      if (!todayPlan) {
        warnings.push({
          code: 'no_planned_today',
          message: 'No planned workout found for today in the active plan.',
          severity: 'warn',
        });
      }
      break;
    }
  }

  const blocked = warnings.some(w => HARD_BLOCKERS.has(w.code));
  return {
    ok: !blocked,
    warnings,
    augmentedSystemSuffix: augmentations.length
      ? `\n\n## SUPERVISOR NOTES\n${augmentations.map(a => `- ${a}`).join('\n')}`
      : undefined,
  };
}

/** Treat as a separate gate so chat/ask can call it explicitly. */
export function requireActivePlan(plan: TrainingPlan | null | undefined): PreflightWarning | null {
  if (plan) return null;
  return {
    code: 'no_active_plan_for_modification',
    message: 'Plan modification was requested but no active plan exists.',
    severity: 'block',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function planWeekForDate(plan: TrainingPlan, when: Date) {
  if (!plan.plan_json?.weeks || !plan.start_date) return null;
  const info = calculateCurrentWeek(plan.start_date, plan.duration_weeks, when);
  if (info.isBeforeStart || info.isAfterEnd) return null;
  return plan.plan_json.weeks[info.currentWeek - 1] || null;
}

function plannedWorkoutForDate(plan: TrainingPlan, when: Date) {
  const week = planWeekForDate(plan, when);
  if (!week || !week.workouts) return null;
  const dayName = when.toLocaleDateString('en-US', { weekday: 'long' });
  return week.workouts[dayName] || null;
}

/** Stringify warnings for the coach_calls.preflight_warnings array. */
export function serializeWarnings(warnings: PreflightWarning[]): string[] {
  return warnings.map(w => `${w.code}:${w.severity}`);
}
