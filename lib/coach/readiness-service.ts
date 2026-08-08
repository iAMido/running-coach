/**
 * The readiness verdict, assembled from the database.
 *
 * `computeReadiness` is pure; this is the one place that decides which rows to
 * feed it. Extracted when the weekly scorecard needed the same verdict the
 * dashboard shows — two assemblies of the same inputs would eventually disagree,
 * and the app contradicting itself is the failure the deterministic verdict
 * exists to prevent.
 */

import { getRecentFeedback, getWeeklySummary, getCurrentWeekStart } from '@/lib/db/feedback';
import { getLatestRecoveryReading, getWellnessBaselines } from '@/lib/db/wellness';
import { calculateFatigueScore } from '@/lib/rag/user-formatter';
import { computeReadiness, type ReadinessVerdict, type RecoverySignals } from '@/lib/utils/readiness';
import { plannedWorkoutForRunDate } from '@/lib/ai/run-reaction';
import { supabase } from '@/lib/db/supabase';
import type { TrainingPlan } from '@/lib/db/types';

export interface ReadinessForUser {
  readiness: ReadinessVerdict;
  fatigueScore: number | null;
  /** Age of the recovery readings in days; null when there are none. */
  recoveryAgeDays: number | null;
  /** The signals the verdict was computed from — the dashboard tile renders these. */
  recovery: RecoverySignals | null;
}

export async function readinessForUser(
  userId: string,
  plan: TrainingPlan | null,
): Promise<ReadinessForUser> {
  const yesterday36h = new Date(Date.now() - 36 * 60 * 60 * 1000);

  const [feedback, weeklySummary, lastRunRes] = await Promise.all([
    getRecentFeedback(userId, 7),
    getWeeklySummary(userId, getCurrentWeekStart()),
    supabase
      .from('runs')
      .select('pct_z4, pct_z5, pct_z6, run_type, distance_km')
      .eq('user_id', userId)
      .gte('date', yesterday36h.toISOString())
      .order('date', { ascending: false })
      .limit(1),
  ]);

  const fatigueScore = calculateFatigueScore(feedback, weeklySummary);
  const { workout: todaysWorkout } = plannedWorkoutForRunDate(plan, new Date());

  // Best-effort: a wellness outage degrades the verdict to training-load rules,
  // it never breaks the caller.
  let recovery: RecoverySignals | null = null;
  let recoveryAgeDays: number | null = null;
  try {
    const [latest, baselines] = await Promise.all([
      getLatestRecoveryReading(userId),
      getWellnessBaselines(userId),
    ]);
    if (latest) {
      recoveryAgeDays = latest.ageDays;
      recovery = {
        hrv: latest.row.hrv ?? null,
        hrvPrevious: latest.previousHrv,
        hrvPreviousIsConsecutive: latest.previousHrvIsConsecutive,
        restingHr: latest.row.resting_hr ?? null,
        sleepSecs: latest.row.sleep_secs ?? null,
        sleepScore: latest.row.sleep_score ?? null,
        hrvBaseline: baselines.hrvMean,
        hrvSd: baselines.hrvSd,
        restingHrBaseline: baselines.restingHrMean,
        ageDays: latest.ageDays,
      };
    }
  } catch (err) {
    console.error('readiness: wellness lookup failed, falling back to load only:', err);
  }

  return {
    readiness: computeReadiness({
      fatigueScore,
      yesterdayRun: lastRunRes.data?.[0] ?? null,
      todaysWorkout,
      recovery,
    }),
    fatigueScore,
    recoveryAgeDays,
    recovery,
  };
}
