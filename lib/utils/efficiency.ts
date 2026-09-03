/**
 * Efficiency Factor: grade-adjusted speed per heartbeat.
 *
 * `EF = (1000 / gap_pace_min_km) / avg_hr` — metres per minute, per bpm.
 *
 * ## The question it answers that CTL cannot
 *
 * CTL says how much work is going in. It rises whenever volume rises and says
 * nothing about whether the body is getting better at the work. EF is the other
 * half: the same pace at a lower heart rate, or a faster pace at the same heart
 * rate, is aerobic adaptation. Measured on this athlete (2026-08-07): CTL up 2.0
 * in four weeks while EF has been flat since May. Both true, and only one of
 * them was visible.
 *
 * ## Never per-run
 *
 * A single run's EF is dominated by heat, sleep, terrain and how the watch
 * caught the first kilometre. Rolling 42-day MEDIAN only — the median because
 * one 4-minute jog or one race can drag a mean several percent.
 *
 * ## Comparisons are season-matched, and refuse rather than guess
 *
 * Israeli summer costs efficiency directly: hotter blood, higher HR for the same
 * work. Comparing August to December measures the weather. So the baseline is
 * the same time of year, one year earlier.
 *
 * That window has to be wide enough to contain runs. The naive version — the
 * same 42 days, one year back — returns **n=1** for today, because grade
 * adjustment only exists from 2025-08-05 and a 42-day lookback from August 2026
 * lands almost entirely before it. It produced a confident-looking 1.123, which
 * is one run. Hence an 84-day window centred a year back, a hard minimum sample
 * count, and every figure carrying its own `n` and date range.
 *
 * ## Gates
 *
 * - Intervals and Fartlek excluded, same as decoupling: work/recovery structure
 *   makes an average pace and an average HR describe no part of the session.
 * - **>= 30 minutes.** There is a 4-minute run in this history. HR lags effort
 *   by a minute or more, so a very short run's EF measures that lag.
 * - GAP pace within 3-12 min/km. Every run currently in range (5.59-8.71), so
 *   this is a no-op today — kept because it is one stair session away from not
 *   being one, and it is the gate that stopped walking laps from being averaged
 *   in as slow running in `decoupling.ts`.
 *
 * Run type composition was checked as a confound and is not one: Easy 1.036,
 * Moderate 1.027, Long Run 1.048, Tempo 1.035 — a 2% spread that cannot
 * manufacture a 10% move.
 */

import { MAX_PLAUSIBLE_PACE_MIN_KM_STEEP, STEEP_CEILING_MIN_M_PER_KM } from '@/lib/utils/decoupling';

/** Minimum session length for EF to describe efficiency rather than HR lag. */
export const MIN_EF_DURATION_MIN = 30;
/** Shared with decoupling.ts: outside this, it is not running. */
export const MIN_EF_PACE_MIN_KM = 3;
export const MAX_EF_PACE_MIN_KM = 12;

/**
 * Ceiling for a genuine climbing session. Mirrors decoupling's steep ceiling so
 * the two metrics agree about what counts as running — they are read side by
 * side in the scorecard and the weekly loop, and a session that decoupling
 * measured but efficiency discarded would be an unexplainable disagreement.
 *
 * Without this, efficiency goes dark on exactly the sessions the mountain
 * build is made of, and the Saturday loop loses one of its triggers at the
 * moment it matters most.
 */
export const MAX_EF_PACE_MIN_KM_STEEP = MAX_PLAUSIBLE_PACE_MIN_KM_STEEP;
/** Structured sessions have no meaningful average. */
const EXCLUDED_TYPES = /interval|fartlek/i;

/** Rolling window for the current value. */
export const EF_WINDOW_DAYS = 42;
/** Season-matched baseline: 84 days centred one year back (±42). */
export const EF_BASELINE_HALF_WIDTH_DAYS = 42;
/** Below this, a window is an anecdote. The naive baseline returns n=1. */
export const MIN_EF_SAMPLES = 8;

export interface EfRun {
  /** ISO timestamp or YYYY-MM-DD. */
  date: string;
  runType: string | null;
  durationMin: number | null;
  avgHr: number | null;
  gapPaceMinKm: number | null;
  /**
   * Metres of climb per km. Raises the pace ceiling for a climbing session.
   * Absent means the gradient was not measured, which is NOT the same as flat
   * — so the road ceiling applies and the run is judged as it always was.
   */
  vertPerKm?: number | null;
}

export interface EfWindow {
  median: number;
  n: number;
  from: string;
  to: string;
}

export interface EfficiencySummary {
  current: EfWindow | null;
  /** Same season one year earlier. Null when too thin to compare. */
  seasonBaseline: EfWindow | null;
  /** Percent change vs the season baseline; null when there is no baseline. */
  pctVsBaseline: number | null;
  /** Recent rolling values, oldest first, for direction. */
  trend: EfWindow[];
}

/** Metres per minute per bpm, or null when the inputs cannot support it. */
export function efficiencyFactor(gapPaceMinKm: number | null | undefined, avgHr: number | null | undefined): number | null {
  if (typeof gapPaceMinKm !== 'number' || gapPaceMinKm <= 0) return null;
  if (typeof avgHr !== 'number' || avgHr <= 0) return null;
  return 1000 / gapPaceMinKm / avgHr;
}

export function isEfEligible(run: EfRun): boolean {
  if (run.runType && EXCLUDED_TYPES.test(run.runType)) return false;
  if (typeof run.durationMin !== 'number' || run.durationMin < MIN_EF_DURATION_MIN) return false;
  if (typeof run.gapPaceMinKm !== 'number') return false;
  const steep =
    typeof run.vertPerKm === 'number' &&
    Number.isFinite(run.vertPerKm) &&
    run.vertPerKm >= STEEP_CEILING_MIN_M_PER_KM;
  const ceiling = steep ? MAX_EF_PACE_MIN_KM_STEEP : MAX_EF_PACE_MIN_KM;
  if (run.gapPaceMinKm < MIN_EF_PACE_MIN_KM || run.gapPaceMinKm > ceiling) return false;
  return efficiencyFactor(run.gapPaceMinKm, run.avgHr) !== null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayOf(date: string): string {
  return date.slice(0, 10);
}

function shiftDays(day: string, days: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Median EF over `[from, to]` inclusive, or null below `minSamples`.
 *
 * Returning null rather than a number computed from three runs is the whole
 * point: a thin window still produces a confident-looking figure, and this
 * metric's job is to answer "is the training working", where a wrong answer
 * changes what the athlete does for a month.
 */
export function efWindow(runs: EfRun[], from: string, to: string, minSamples = MIN_EF_SAMPLES): EfWindow | null {
  const values: number[] = [];
  for (const run of runs) {
    if (!isEfEligible(run)) continue;
    const day = dayOf(run.date);
    if (day < from || day > to) continue;
    const ef = efficiencyFactor(run.gapPaceMinKm, run.avgHr);
    if (ef !== null) values.push(ef);
  }
  if (values.length < minSamples) return null;
  return { median: median(values), n: values.length, from, to };
}

/**
 * Current rolling value, its season-matched baseline, and recent direction.
 *
 * `today` is passed in rather than read from the clock — this runs server-side,
 * where a bare `new Date()` answers in UTC. Callers use `userDateStr()`.
 */
export function buildEfficiencySummary(runs: EfRun[], today: string): EfficiencySummary {
  const current = efWindow(runs, shiftDays(today, -EF_WINDOW_DAYS + 1), today);

  // One year back, widened to ±42 days. The same 42-day window one year earlier
  // holds a single run for today's date; see the header.
  const centre = shiftDays(today, -365);
  const seasonBaseline = efWindow(
    runs,
    shiftDays(centre, -EF_BASELINE_HALF_WIDTH_DAYS),
    shiftDays(centre, EF_BASELINE_HALF_WIDTH_DAYS),
  );

  const pctVsBaseline =
    current && seasonBaseline
      ? Math.round(((current.median - seasonBaseline.median) / seasonBaseline.median) * 1000) / 10
      : null;

  // Four windows at three-week steps: enough to distinguish a trend from the
  // ±2% wobble that a 42-day median shows anyway.
  const trend: EfWindow[] = [];
  for (let stepsBack = 3; stepsBack >= 0; stepsBack--) {
    const end = shiftDays(today, -21 * stepsBack);
    const w = efWindow(runs, shiftDays(end, -EF_WINDOW_DAYS + 1), end);
    if (w) trend.push(w);
  }

  return { current, seasonBaseline, pctVsBaseline, trend };
}

/**
 * The block the coach reads. Empty string when there is nothing honest to say.
 *
 * Every figure carries its sample count and window, because the failure this
 * metric invites is a precise-looking percentage resting on one run.
 */
export function formatEfficiency(summary: EfficiencySummary): string {
  const { current, seasonBaseline, pctVsBaseline, trend } = summary;
  if (!current) {
    return '';
  }

  const lines: string[] = ['## Aerobic efficiency (grade-adjusted speed per heartbeat)'];
  lines.push(
    `- Now: ${current.median.toFixed(3)} m/min per bpm — median of ${current.n} steady runs, ${current.from} to ${current.to}.`,
  );

  if (seasonBaseline && pctVsBaseline !== null) {
    const direction = pctVsBaseline >= 0 ? 'higher' : 'lower';
    lines.push(
      `- Same season last year: ${seasonBaseline.median.toFixed(3)} (${seasonBaseline.n} runs, ` +
        `${seasonBaseline.from} to ${seasonBaseline.to}) — currently ${Math.abs(pctVsBaseline).toFixed(1)}% ${direction}.`,
    );
    lines.push(
      '  Season-matched on purpose: Israeli summer raises heart rate for the same work, so an August-to-December comparison would measure the weather.',
    );
  } else {
    lines.push(
      `- No season-matched baseline yet: fewer than ${MIN_EF_SAMPLES} eligible runs in the same period last year. ` +
        'Do not substitute a different time of year — heat moves this number more than fitness does.',
    );
  }

  if (trend.length >= 2) {
    const series = trend.map((w) => `${w.to} ${w.median.toFixed(3)} (n=${w.n})`).join(' → ');
    const values = trend.map((w) => w.median);
    const first = values[0];
    const last = values[values.length - 1];

    // Net and spread are both reported, because either alone lies. First-vs-last
    // calls 0.9 → 1.1 → 0.9 "flat"; max-minus-min calls a noisy but steady
    // series a decline. A trend is only real when the net movement is large
    // relative to how much the series wanders on its own.
    const net = ((last - first) / first) * 100;
    const spread = ((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100;

    lines.push(`- Recent rolling windows: ${series}.`);
    lines.push(
      Math.abs(net) < 3 || Math.abs(net) < spread / 2
        ? `  Flat: net ${net >= 0 ? '+' : ''}${net.toFixed(1)}% across the series, which wobbles ${spread.toFixed(1)}% within it. ` +
          'A 42-day median moves this much on its own — do not describe it as rising or falling.'
        : `  ${last > first ? 'Improving' : 'Declining'}: net ${net >= 0 ? '+' : ''}${net.toFixed(1)}% across the series (wobble within it: ${spread.toFixed(1)}%).`,
    );
  }

  return lines.join('\n');
}
