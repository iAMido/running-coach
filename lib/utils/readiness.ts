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
 * v2 rules, deliberately conservative and ordered most-severe first:
 *   1. Plan says rest today                             → REST
 *   2. HRV suppressed two days running                  → REST
 *   3. Fatigue >= 7.5                                   → REST
 *   4. Sleep < 5h                                       → cap at EASY
 *   5. HRV >1 SD below baseline and today is quality    → EASY
 *   6. Yesterday hot (>40% Z4+) and today is quality    → EASY (swap warning)
 *   7. Fatigue >= 6                                     → EASY
 *   8. Otherwise                                        → GO
 *
 * ## Missing data is not bad data
 *
 * HRV is absent roughly 12% of the year — nights the watch was off. Every
 * recovery rule below is gated on the reading AND its baseline being present,
 * so an absent night falls through to the v1 training-load logic rather than
 * reading as catastrophic recovery. `reasons` says so explicitly, because a
 * verdict that silently ignored a rule is worse than one that admits it.
 *
 * Resting HR deliberately does NOT gate a verdict on its own; it only nudges
 * the fatigue score. It is the noisiest of the three signals (illness, alcohol,
 * a warm room) and does not warrant overriding a plan by itself.
 */

import type { Run, Workout } from '@/lib/db/types';

export type ReadinessLevel = 'GO' | 'EASY' | 'REST';

export interface ReadinessVerdict {
  verdict: ReadinessLevel;
  /** Human-readable reasons, most important first. Shown under the badge. */
  reasons: string[];
  /** True when recovery data was present and actually influenced the verdict. */
  usedRecoveryData: boolean;
}

/** One day of recovery signals. Any field may be null — see the header. */
export interface RecoverySignals {
  hrv?: number | null;
  /** Previous day's HRV, for the two-day-suppressed rule. */
  hrvPrevious?: number | null;
  restingHr?: number | null;
  sleepSecs?: number | null;
  sleepScore?: number | null;
  /** Rolling mean; null when coverage is too thin to trust. */
  hrvBaseline?: number | null;
  /** Rolling SD. Without it "below baseline" has no scale, so rules stay off. */
  hrvSd?: number | null;
  restingHrBaseline?: number | null;
}

export interface ReadinessInput {
  /** Composite 1-10 fatigue (from calculateFatigueScore). */
  fatigueScore: number;
  /** Most recent run within ~36h, if any. */
  yesterdayRun?: Pick<Run, 'pct_z4' | 'pct_z5' | 'pct_z6' | 'run_type' | 'distance_km'> | null;
  /** What the plan says today should be, if known. */
  todaysWorkout?: Workout | null;
  /** Today's recovery data. Omit entirely and v1 behaviour is preserved. */
  recovery?: RecoverySignals | null;
}

/** Below baseline by more than this many SDs counts as suppressed. */
const HRV_SUPPRESSED_SD = 1;
/** Under this, sleep caps the verdict regardless of everything else. */
const MIN_SLEEP_SECS = 5 * 3600;
/** Resting HR this far over baseline adds to fatigue. */
const RHR_ELEVATED_BPM = 5;
/** How much an elevated resting HR nudges the fatigue score. */
const RHR_FATIGUE_PENALTY = 0.5;

/**
 * How many SDs below baseline this HRV reading sits, or null when the reading
 * or its baseline is missing — which is the difference between "recovered
 * poorly" and "we don't know".
 */
function hrvDeviation(hrv: number | null | undefined, baseline: number | null | undefined, sd: number | null | undefined): number | null {
  if (typeof hrv !== 'number' || typeof baseline !== 'number' || typeof sd !== 'number' || sd <= 0) {
    return null;
  }
  return (baseline - hrv) / sd;
}

const QUALITY_TYPES = /tempo|threshold|interval|vo2|speed|race|fartlek/i;
const REST_TYPES = /rest|off|recovery day/i;

export function computeReadiness(input: ReadinessInput): ReadinessVerdict {
  const reasons: string[] = [];
  const { yesterdayRun, todaysWorkout, recovery } = input;

  const plannedType = todaysWorkout?.type || '';
  const todayIsQuality = plannedType ? QUALITY_TYPES.test(plannedType) : false;
  const yesterdayHardPct =
    (yesterdayRun?.pct_z4 || 0) + (yesterdayRun?.pct_z5 || 0) + (yesterdayRun?.pct_z6 || 0);

  const hrvDev = hrvDeviation(recovery?.hrv, recovery?.hrvBaseline, recovery?.hrvSd);
  const hrvDevPrev = hrvDeviation(recovery?.hrvPrevious, recovery?.hrvBaseline, recovery?.hrvSd);
  const sleepSecs = typeof recovery?.sleepSecs === 'number' ? recovery.sleepSecs : null;

  // Resting HR only nudges fatigue — never decides a verdict alone. See header.
  let fatigueScore = input.fatigueScore;
  let rhrElevatedBy: number | null = null;
  if (typeof recovery?.restingHr === 'number' && typeof recovery?.restingHrBaseline === 'number') {
    const over = recovery.restingHr - recovery.restingHrBaseline;
    if (over >= RHR_ELEVATED_BPM) {
      rhrElevatedBy = over;
      fatigueScore = Math.min(10, fatigueScore + RHR_FATIGUE_PENALTY);
    }
  }

  const usedRecoveryData = hrvDev !== null || sleepSecs !== null || rhrElevatedBy !== null;

  const noteRecoveryGap = () => {
    if (recovery && hrvDev === null) {
      reasons.push(
        recovery.hrv == null
          ? 'No HRV reading for today, so this verdict is based on training load alone.'
          : 'Not enough HRV history yet for a baseline, so this verdict is based on training load alone.',
      );
    }
  };

  // 1. Plan-mandated rest wins.
  if (plannedType && REST_TYPES.test(plannedType)) {
    reasons.push('Plan calls for a rest day — take it.');
    if (yesterdayHardPct > 40) reasons.push(`Yesterday ran hot (${Math.round(yesterdayHardPct)}% in Z4+), so the rest is earned.`);
    return { verdict: 'REST', reasons, usedRecoveryData };
  }

  // 2. HRV suppressed two days running — a trend, not a bad night.
  if (hrvDev !== null && hrvDevPrev !== null && hrvDev > HRV_SUPPRESSED_SD && hrvDevPrev > HRV_SUPPRESSED_SD) {
    reasons.push(`HRV has been more than ${HRV_SUPPRESSED_SD} SD below your baseline two days running — that is a recovery trend, not one bad night.`);
    reasons.push('Take the day off; the adaptation happens while you rest.');
    return { verdict: 'REST', reasons, usedRecoveryData };
  }

  // 3. Deep fatigue.
  if (fatigueScore >= 7.5) {
    reasons.push(`Fatigue ${fatigueScore.toFixed(1)}/10 — body is asking for a day off.`);
    if (rhrElevatedBy !== null) reasons.push(`Resting HR is ${Math.round(rhrElevatedBy)} bpm above baseline, which fed into that.`);
    return { verdict: 'REST', reasons, usedRecoveryData };
  }

  // 4. Short sleep caps the day regardless of how fresh the load looks.
  if (sleepSecs !== null && sleepSecs < MIN_SLEEP_SECS) {
    reasons.push(`Only ${(sleepSecs / 3600).toFixed(1)}h of sleep — under 5h, intensity costs more than it returns.`);
    if (todayIsQuality) reasons.push(`Today's plan is ${plannedType}; move it rather than run it tired.`);
    return { verdict: 'EASY', reasons, usedRecoveryData };
  }

  // 5. Suppressed HRV colliding with a quality session.
  if (hrvDev !== null && hrvDev > HRV_SUPPRESSED_SD && todayIsQuality) {
    reasons.push(`HRV is ${hrvDev.toFixed(1)} SD below your baseline and today's plan is ${plannedType} — your body has not finished absorbing the last session.`);
    reasons.push('Keep it easy and move the quality day.');
    return { verdict: 'EASY', reasons, usedRecoveryData };
  }

  // 6. Hard yesterday + quality today = collision.
  if (yesterdayHardPct > 40 && todayIsQuality) {
    reasons.push(`Yesterday was ${Math.round(yesterdayHardPct)}% Z4+ and today's plan is ${plannedType} — back-to-back hard days invite injury.`);
    reasons.push('Consider swapping today for easy and moving the quality session.');
    return { verdict: 'EASY', reasons, usedRecoveryData };
  }

  // 7. Moderate fatigue.
  if (fatigueScore >= 6) {
    reasons.push(`Fatigue ${fatigueScore.toFixed(1)}/10 — run, but keep it genuinely easy.`);
    if (rhrElevatedBy !== null) reasons.push(`Resting HR is ${Math.round(rhrElevatedBy)} bpm above baseline.`);
    return { verdict: 'EASY', reasons, usedRecoveryData };
  }

  // 8. Green light.
  if (todayIsQuality) {
    reasons.push(`Fresh (fatigue ${fatigueScore.toFixed(1)}/10) — good day for the planned ${plannedType}.`);
  } else if (plannedType) {
    reasons.push(`Fresh — on plan for ${plannedType}.`);
  } else {
    reasons.push(`Fresh (fatigue ${fatigueScore.toFixed(1)}/10).`);
  }
  if (hrvDev !== null && hrvDev < -HRV_SUPPRESSED_SD) {
    reasons.push(`HRV is ${Math.abs(hrvDev).toFixed(1)} SD above baseline — well recovered.`);
  }
  noteRecoveryGap();
  return { verdict: 'GO', reasons, usedRecoveryData };
}
