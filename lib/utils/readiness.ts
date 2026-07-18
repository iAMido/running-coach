/**
 * Deterministic daily readiness verdict: GO / EASY / REST.
 *
 * All the signals already exist in the app (fatigue score, yesterday's
 * zone distribution, today's planned workout) — but the athlete had to
 * ask the chat to synthesize them. This computes the same synthesis in
 * pure TypeScript: no LLM, no cost, instant, and consistent — the chat
 * coach can reference the same verdict so the app never contradicts
 * itself.
 *
 * v1 rules, deliberately conservative:
 *   1. Plan says rest today            → REST
 *   2. Fatigue >= 7.5                  → REST
 *   3. Yesterday hot (>40% Z4+) and today is quality → EASY (swap warning)
 *   4. Fatigue >= 6                    → EASY
 *   5. Otherwise                       → GO
 */

import type { Run, Workout } from '@/lib/db/types';

export type ReadinessLevel = 'GO' | 'EASY' | 'REST';

export interface ReadinessVerdict {
  verdict: ReadinessLevel;
  /** Human-readable reasons, most important first. Shown under the badge. */
  reasons: string[];
}

export interface ReadinessInput {
  /** Composite 1-10 fatigue (from calculateFatigueScore). */
  fatigueScore: number;
  /** Most recent run within ~36h, if any. */
  yesterdayRun?: Pick<Run, 'pct_z4' | 'pct_z5' | 'pct_z6' | 'run_type' | 'distance_km'> | null;
  /** What the plan says today should be, if known. */
  todaysWorkout?: Workout | null;
}

const QUALITY_TYPES = /tempo|threshold|interval|vo2|speed|race|fartlek/i;
const REST_TYPES = /rest|off|recovery day/i;

export function computeReadiness(input: ReadinessInput): ReadinessVerdict {
  const reasons: string[] = [];
  const { fatigueScore, yesterdayRun, todaysWorkout } = input;

  const plannedType = todaysWorkout?.type || '';
  const yesterdayHardPct =
    (yesterdayRun?.pct_z4 || 0) + (yesterdayRun?.pct_z5 || 0) + (yesterdayRun?.pct_z6 || 0);

  // 1. Plan-mandated rest wins.
  if (plannedType && REST_TYPES.test(plannedType)) {
    reasons.push('Plan calls for a rest day — take it.');
    if (yesterdayHardPct > 40) reasons.push(`Yesterday ran hot (${Math.round(yesterdayHardPct)}% in Z4+), so the rest is earned.`);
    return { verdict: 'REST', reasons };
  }

  // 2. Deep fatigue.
  if (fatigueScore >= 7.5) {
    reasons.push(`Fatigue ${fatigueScore.toFixed(1)}/10 — body is asking for a day off.`);
    return { verdict: 'REST', reasons };
  }

  // 3. Hard yesterday + quality today = collision.
  const todayIsQuality = plannedType ? QUALITY_TYPES.test(plannedType) : false;
  if (yesterdayHardPct > 40 && todayIsQuality) {
    reasons.push(`Yesterday was ${Math.round(yesterdayHardPct)}% Z4+ and today's plan is ${plannedType} — back-to-back hard days invite injury.`);
    reasons.push('Consider swapping today for easy and moving the quality session.');
    return { verdict: 'EASY', reasons };
  }

  // 4. Moderate fatigue.
  if (fatigueScore >= 6) {
    reasons.push(`Fatigue ${fatigueScore.toFixed(1)}/10 — run, but keep it genuinely easy.`);
    return { verdict: 'EASY', reasons };
  }

  // 5. Green light.
  if (todayIsQuality) {
    reasons.push(`Fresh (fatigue ${fatigueScore.toFixed(1)}/10) — good day for the planned ${plannedType}.`);
  } else if (plannedType) {
    reasons.push(`Fresh — on plan for ${plannedType}.`);
  } else {
    reasons.push(`Fresh (fatigue ${fatigueScore.toFixed(1)}/10).`);
  }
  return { verdict: 'GO', reasons };
}
