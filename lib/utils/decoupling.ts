/**
 * Aerobic decoupling (Pa:HR) — does efficiency hold across a steady effort?
 *
 * Efficiency factor = speed ÷ heart rate. Compute it for each half of the run;
 * if the second half needs more heartbeats for the same speed, the aerobic
 * system is fading. `(EF₁ − EF₂) / EF₁ × 100`.
 *
 * ## Why this uses grade-adjusted pace, not raw speed
 *
 * The textbook version uses raw speed, which is confounded by terrain: on a
 * route that descends in the back half, speed rises for free, EF₂ inflates, and
 * decoupling reads better than the physiology was — optimistic on exactly the
 * sessions you want an honest read of.
 *
 * That is not hypothetical here. All five of this athlete's largest
 * grade-adjustment deltas are quality sessions that climb out and descend back.
 * The steady runs decoupling actually computes on lean the other way: Easy runs
 * average −14.6 s/km and Long Runs −16.2 s/km of *uphill* adjustment. Either
 * direction, raw speed is measuring the hill as much as the athlete.
 *
 * intervals.icu already publishes a grade-adjusted pace per lap, so this uses
 * their grade model rather than inventing one with hand-picked coefficients,
 * and needs no extra stream fetch.
 *
 * The cost is granularity: laps, not per-second samples, and halves that split
 * on a lap boundary rather than exactly 50%. Both are handled below.
 *
 * ## What this deliberately does not do
 *
 * No raw-speed fallback for runs with too few laps. That would put a second,
 * non-comparable measurement in the same column, which is how a metric quietly
 * becomes meaningless. Null plus a reason is better.
 *
 * No warm-up exclusion. Dropping the first 10 minutes was tested against this
 * athlete's history: the mean moved 0.6pp and the median 0.1pp, while 11 of 76
 * runs fell below the lap minimum and the extremes widened. It bought noise and
 * lost sample.
 */

/** Minimum laps carrying both grade-adjusted pace and HR. */
export const MIN_DECOUPLING_LAPS = 6;

/**
 * Halves must land near even. A lap boundary can put the split at 58/42, which
 * moves the result by more than the bands separate. Measured on this athlete's
 * history, 40–60% rejects 3 runs of 79 — cheap, rarely fires, catches the
 * genuinely lopsided ones.
 */
export const SPLIT_MIN_FRACTION = 0.4;
export const SPLIT_MAX_FRACTION = 0.6;

/**
 * Interval and fartlek structure makes decoupling meaningless — the
 * work/recovery alternation dominates any aerobic drift signal.
 */
const EXCLUDED_RUN_TYPES = /interval|fartlek/i;

export type DecouplingMethod = 'lap_gap';

export interface DecouplingLap {
  durationSec?: number | null;
  avgHr?: number | null;
  gapPaceMinKm?: number | null;
}

export interface DecouplingResult {
  decouplingPct: number | null;
  method: DecouplingMethod | null;
  /** Present when null — says why, so "not computed" never reads as "0%". */
  skippedReason?: string;
  /** Fraction of total time in the first half; ~0.5 when laps divide evenly. */
  splitFraction?: number;
  lapsUsed?: number;
}

/** A lap that carries all three fields, non-null. */
interface UsableLap {
  durationSec: number;
  avgHr: number;
  gapPaceMinKm: number;
}

interface HalfStats {
  gaDistanceKm: number;
  durationMin: number;
  weightedHr: number;
}

function summarise(laps: UsableLap[]): HalfStats {
  let gaDistanceKm = 0;
  let durationMin = 0;
  let weightedHr = 0;

  for (const lap of laps) {
    const min = lap.durationSec / 60;
    // gap_pace is min/km, so time ÷ pace is the grade-adjusted distance the
    // effort was "worth" on flat ground.
    gaDistanceKm += min / lap.gapPaceMinKm;
    durationMin += min;
    // Duration-weighted: a 4-minute lap and a 40-second one must not count
    // equally toward mean HR.
    weightedHr += lap.avgHr * min;
  }

  return { gaDistanceKm, durationMin, weightedHr };
}

const efficiencyFactor = (h: HalfStats): number =>
  h.gaDistanceKm / h.durationMin / (h.weightedHr / h.durationMin);

export function computeDecoupling(laps: DecouplingLap[], runType?: string | null): DecouplingResult {
  if (runType && EXCLUDED_RUN_TYPES.test(runType)) {
    return { decouplingPct: null, method: null, skippedReason: `not meaningful for ${runType}` };
  }

  const usable: UsableLap[] = (laps ?? []).flatMap((l) =>
    typeof l.durationSec === 'number' && l.durationSec > 0 &&
    typeof l.avgHr === 'number' && l.avgHr > 0 &&
    typeof l.gapPaceMinKm === 'number' && l.gapPaceMinKm > 0
      ? [{ durationSec: l.durationSec, avgHr: l.avgHr, gapPaceMinKm: l.gapPaceMinKm }]
      : [],
  );

  if (usable.length < MIN_DECOUPLING_LAPS) {
    return {
      decouplingPct: null,
      method: null,
      skippedReason: `only ${usable.length} laps with pace+HR (need ${MIN_DECOUPLING_LAPS})`,
    };
  }

  const totalMin = usable.reduce((sum, l) => sum + l.durationSec / 60, 0);
  const halfway = totalMin / 2;

  let running = 0;
  let splitIndex = 0;
  for (let i = 0; i < usable.length; i++) {
    running += usable[i].durationSec / 60;
    if (running >= halfway) {
      splitIndex = i + 1;
      break;
    }
  }

  // Both halves must contain at least one lap.
  if (splitIndex < 1 || splitIndex >= usable.length) {
    return { decouplingPct: null, method: null, skippedReason: 'laps do not divide into two halves' };
  }

  const firstHalf = summarise(usable.slice(0, splitIndex));
  const secondHalf = summarise(usable.slice(splitIndex));
  const splitFraction = firstHalf.durationMin / totalMin;

  if (splitFraction < SPLIT_MIN_FRACTION || splitFraction > SPLIT_MAX_FRACTION) {
    return {
      decouplingPct: null,
      method: null,
      splitFraction,
      skippedReason: `halves too uneven (${Math.round(splitFraction * 100)}/${Math.round((1 - splitFraction) * 100)})`,
    };
  }

  const ef1 = efficiencyFactor(firstHalf);
  const ef2 = efficiencyFactor(secondHalf);
  if (!Number.isFinite(ef1) || !Number.isFinite(ef2) || ef1 <= 0) {
    return { decouplingPct: null, method: null, skippedReason: 'efficiency factor not computable' };
  }

  return {
    decouplingPct: Math.round(((ef1 - ef2) / ef1) * 1000) / 10,
    method: 'lap_gap',
    splitFraction,
    lapsUsed: usable.length,
  };
}

/**
 * Where a value sits in the athlete's own history, 0-100.
 *
 * This is what gets rendered rather than a bare verdict. Friel's <5 / 5-8 / >8
 * bands are defined on RAW Pa:HR and calibrated on other athletes; applied
 * unchanged here they would label a third of this athlete's easy and long
 * running as "went too hard". That may be true — rebuilding at CTL 17.7 through
 * an Israeli August, thermal drift on easy runs is exactly what raises Pa:HR —
 * or the threshold may simply not be his. There is not yet enough history to
 * tell, so the honest output is his own percentile, and the convention as
 * context rather than judgment.
 */
export function percentileOf(value: number, distribution: number[]): number | null {
  const sorted = distribution.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 10) return null;
  const below = sorted.filter((v) => v < value).length;
  return Math.round((below / sorted.length) * 100);
}

export function medianOf(distribution: number[]): number | null {
  const sorted = distribution.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}
