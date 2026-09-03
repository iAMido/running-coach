/**
 * The athlete's current training state — one assembly point, many readers.
 *
 * ## Why this exists
 *
 * Three loops need to reason about "how is training actually going": the
 * weekly plan-adjustment proposal, the macro phase re-evaluation, and the chat
 * coach. Built separately they would drift, and this codebase already learned
 * that lesson once — `readinessForUser` exists precisely so the dashboard tile
 * and the weekly scorecard cannot disagree about a GO/EASY/REST verdict. Same
 * discipline, wider scope.
 *
 * ## The absence rule
 *
 * Every field here distinguishes **measured** from **absent**, and the `gaps`
 * array names what could not be measured at all. This is not defensive
 * decoration: elevation exists on 128 of 692 runs, zones on 128, decoupling on
 * 73, and HRV is missing roughly one night in eight. A state object that
 * quietly rendered those as zero would feed a confident adjustment built on
 * nothing — the exact failure that put 204 impossible Z6 readings into this
 * database and that every metric added since has been shaped to avoid.
 *
 * Nothing here is a verdict. It is evidence, assembled once, for a reader that
 * decides.
 */

import { supabase } from '@/lib/db/supabase';
import { getActivePlan } from '@/lib/db/plans';
import { getAthleteProfile } from '@/lib/db/profile';
import { getClimbBaseline, type ClimbBaseline } from '@/lib/db/runs';
import { getRecentWellness } from '@/lib/db/wellness';
import { readinessForUser, type ReadinessForUser } from '@/lib/coach/readiness-service';
import { buildEfficiencySummary, type EfRun, type EfficiencySummary } from '@/lib/utils/efficiency';
import { medianOf, percentileOf } from '@/lib/utils/decoupling';
import { dateInUserTz, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { AthleteProfile, TrainingPlan } from '@/lib/db/types';

/** Rising / falling only when the change clears the deadband below. */
export type TrendDirection = 'rising' | 'flat' | 'falling';

/**
 * A week-on-week change smaller than this is noise, not a trend.
 *
 * 10% is deliberately wide. Weekly volume swings on a missed session alone —
 * one 8 km run out of a 30 km week is 27% — so a tighter band would report a
 * direction for every ordinary week and the word "rising" would stop meaning
 * anything.
 */
const TREND_DEADBAND = 0.1;

export interface WeeklyBucket {
  /** Sunday, YYYY-MM-DD, in the athlete's timezone. */
  weekStart: string;
  /**
   * True for the week currently in progress.
   *
   * Load-bearing: a partial week is real data but NOT a comparable data point.
   * Counting Thursday's 1 run as a week made volume read "falling 52%" on an
   * ordinary week — the trend was measuring the calendar, not the training.
   * Kept in `weeks` because it is genuine, excluded from every trend.
   */
  isPartial: boolean;
  runs: number;
  km: number;
  /**
   * Metres climbed. **Null when no run that week carried an elevation
   * reading** — which is not the same as a flat week, and the two must never
   * render alike.
   */
  vertM: number | null;
  /** How many of the week's runs actually carried elevation. */
  vertMeasuredRuns: number;
  trimp: number | null;
}

export interface AdherenceState {
  /**
   * The days the athlete says he trains, parsed from
   * `athlete_profile.training_days`. Null when unset — and unset must NOT be
   * read as "any day", or adherence becomes trivially 100%.
   */
  plannedDays: string[] | null;
  /** Actual runs per weekday over the window, in the athlete's timezone. */
  actualDayCounts: Record<string, number>;
  runsOnPlannedDays: number;
  totalRuns: number;
  /** Share of runs landing on a stated training day. Null when days are unset. */
  rate: number | null;
}

export interface TrendState {
  /** Mean of the most recent 2 complete weeks. */
  recent: number | null;
  /** Mean of the 2 weeks before those. */
  prior: number | null;
  direction: TrendDirection | null;
  /** Percent change, recent vs prior. Null when either side is missing. */
  pctChange: number | null;
}

export interface DecouplingState {
  /** Median across the athlete's whole history — his own reference, not Friel's. */
  allTimeMedian: number | null;
  /** Median over the window. */
  recentMedian: number | null;
  /** Where the recent median sits in his own distribution, 0-100. */
  recentPercentile: number | null;
  /** Runs in the window that produced a value at all. */
  measuredRuns: number;
}

export interface LoadState {
  ctl: number | null;
  atl: number | null;
  /** ctl - atl. Positive is fresh. */
  form: number | null;
}

export interface TrainingState {
  generatedAt: string;
  windowDays: number;
  /** Oldest first, most recent last. The final entry may be a partial week. */
  weeks: WeeklyBucket[];
  volumeKm: TrendState;
  vertM: TrendState;
  adherence: AdherenceState;
  efficiency: EfficiencySummary;
  decoupling: DecouplingState;
  load: LoadState;
  readiness: ReadinessForUser | null;
  climb: ClimbBaseline;
  activePlan: TrainingPlan | null;
  injuryHistory: string | null;
  /**
   * Signals that could not be measured, in plain language.
   *
   * Load-bearing. A reader — model or human — must be able to tell "training
   * is going well" from "we cannot see how training is going", and those two
   * produce opposite decisions.
   */
  gaps: string[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * Parse `athlete_profile.training_days` into canonical weekday names.
 *
 * Tolerant by necessity: the field is free text a human types, and has held
 * "Monday (quality - VO2max...), Wednesday, Friday (long run)". Matching on
 * the day name anywhere in the string handles every form it has taken without
 * demanding the athlete write it a particular way.
 */
export function parseTrainingDays(raw: string | null | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  const found = WEEKDAYS.filter((d) => new RegExp(d, 'i').test(raw));
  return found.length > 0 ? [...found] : null;
}

/** Sunday of the week containing `d`, as YYYY-MM-DD in the athlete's timezone. */
function weekStartOf(d: Date): string {
  const local = dateInUserTz(d);
  const sunday = new Date(local);
  sunday.setDate(local.getDate() - local.getDay());
  // `sunday` is a shifted Date (correct calendar fields, deliberately wrong
  // epoch), so it is formatted by hand rather than through userDateStr, which
  // would apply the timezone a second time. See lib/utils/user-time.ts.
  const mm = String(sunday.getMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getDate()).padStart(2, '0');
  return `${sunday.getFullYear()}-${mm}-${dd}`;
}

/** Exported for tests — the partial-week rule is the part worth pinning. */
export function trendOf(values: (number | null)[]): TrendState {
  // Newest last. Take the last two complete weeks against the two before.
  const usable = values.filter((v): v is number => typeof v === 'number');
  if (usable.length < 4) {
    return { recent: null, prior: null, direction: null, pctChange: null };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recent = mean(usable.slice(-2));
  const prior = mean(usable.slice(-4, -2));
  if (prior === 0) return { recent, prior, direction: null, pctChange: null };
  const pctChange = ((recent - prior) / prior) * 100;
  const direction: TrendDirection =
    Math.abs(pctChange) < TREND_DEADBAND * 100 ? 'flat' : pctChange > 0 ? 'rising' : 'falling';
  return { recent, prior, direction, pctChange };
}

interface StateRunRow {
  date: string;
  run_type: string | null;
  distance_km: number | null;
  duration_min: number | null;
  avg_hr: number | null;
  gap_pace_min_km: number | null;
  elevation_gain_m: number | null;
  decoupling_pct: number | null;
  trimp: number | null;
}

/**
 * Assemble everything the adaptation loops read.
 *
 * `windowDays` defaults to 84 (12 weeks) — long enough for a four-week trend
 * comparison to have four weeks on each side of it, short enough that a
 * training block from two seasons ago does not drag the picture.
 */
export async function buildTrainingState(
  userId: string,
  opts: { windowDays?: number; plan?: TrainingPlan | null; profile?: AthleteProfile | null } = {},
): Promise<TrainingState> {
  const windowDays = opts.windowDays ?? 84;
  const since = userDateStrDaysAgo(windowDays);
  const gaps: string[] = [];

  const plan = opts.plan !== undefined ? opts.plan : await getActivePlan(userId);
  const profile = opts.profile !== undefined ? opts.profile : await getAthleteProfile(userId);

  const [runsRes, wellness, climb, readiness, efHistoryRes, dcHistoryRes] = await Promise.all([
    supabase
      .from('runs')
      .select('date,run_type,distance_km,duration_min,avg_hr,gap_pace_min_km,elevation_gain_m,decoupling_pct,trimp')
      .eq('user_id', userId)
      .gte('date', `${since}T00:00:00Z`)
      .order('date', { ascending: true }),
    getRecentWellness(userId, 7).catch(() => []),
    getClimbBaseline(userId, windowDays).catch(() => ({
      measuredRuns: 0, medianVertPerKm: null, maxVertPerKm: null, maxGainM: null, avgWeeklyGainM: null,
    })),
    // Best-effort: readiness needs wellness, and an outage there must not cost
    // the whole state object.
    readinessForUser(userId, plan).catch((err) => {
      console.error('training-state: readiness unavailable:', err);
      return null;
    }),
    // Efficiency needs a full year for its season-matched baseline, so it is
    // fetched over a longer window than everything else here.
    supabase
      .from('runs')
      .select('date,run_type,duration_min,avg_hr,gap_pace_min_km,vert_per_km')
      .eq('user_id', userId)
      .gte('date', `${userDateStrDaysAgo(500)}T00:00:00Z`),
    supabase.from('runs').select('decoupling_pct').eq('user_id', userId).not('decoupling_pct', 'is', null),
  ]);

  const runs = (runsRes.data ?? []) as StateRunRow[];
  if (runs.length === 0) gaps.push('No runs at all in the last ' + windowDays + ' days.');

  // ---- weekly buckets -----------------------------------------------------
  const currentWeekStart = weekStartOf(new Date());
  const byWeek = new Map<string, WeeklyBucket>();
  for (const r of runs) {
    const key = weekStartOf(new Date(r.date));
    const b = byWeek.get(key) ?? {
      weekStart: key, runs: 0, km: 0, vertM: null, vertMeasuredRuns: 0, trimp: null,
      isPartial: key === currentWeekStart,
    };
    b.runs += 1;
    b.km += r.distance_km ?? 0;
    if (typeof r.elevation_gain_m === 'number') {
      b.vertM = (b.vertM ?? 0) + r.elevation_gain_m;
      b.vertMeasuredRuns += 1;
    }
    if (typeof r.trimp === 'number') b.trimp = (b.trimp ?? 0) + r.trimp;
    byWeek.set(key, b);
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  for (const w of weeks) w.km = Math.round(w.km * 10) / 10;

  // Trends read COMPLETE weeks only. The week in progress is excluded — see
  // WeeklyBucket.isPartial.
  const completed = weeks.filter((w) => !w.isPartial);
  const volumeKm = trendOf(completed.map((w) => w.km));
  const vertM = trendOf(completed.map((w) => w.vertM));

  const weeksWithVert = weeks.filter((w) => w.vertM !== null).length;
  if (weeks.length > 0 && weeksWithVert === 0) {
    gaps.push('No elevation data on any run in the window — vert progression cannot be judged.');
  } else if (weeksWithVert < weeks.length) {
    gaps.push(
      `Elevation missing for ${weeks.length - weeksWithVert} of ${weeks.length} weeks — vert totals are floors, not sums.`,
    );
  }

  // ---- adherence ----------------------------------------------------------
  const plannedDays = parseTrainingDays(profile?.training_days);
  const actualDayCounts: Record<string, number> = {};
  for (const d of WEEKDAYS) actualDayCounts[d] = 0;
  for (const r of runs) {
    actualDayCounts[WEEKDAYS[dateInUserTz(new Date(r.date)).getDay()]] += 1;
  }
  const runsOnPlannedDays = plannedDays
    ? plannedDays.reduce((sum, d) => sum + (actualDayCounts[d] ?? 0), 0)
    : 0;
  const adherence: AdherenceState = {
    plannedDays,
    actualDayCounts,
    runsOnPlannedDays,
    totalRuns: runs.length,
    rate: plannedDays && runs.length > 0 ? runsOnPlannedDays / runs.length : null,
  };
  if (!plannedDays) {
    gaps.push('athlete_profile.training_days is not set — adherence to intended days cannot be measured.');
  }

  // ---- efficiency ---------------------------------------------------------
  const efRuns: EfRun[] = ((efHistoryRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    date: String(r.date),
    runType: (r.run_type as string) ?? null,
    durationMin: (r.duration_min as number) ?? null,
    avgHr: (r.avg_hr as number) ?? null,
    gapPaceMinKm: (r.gap_pace_min_km as number) ?? null,
    vertPerKm: (r.vert_per_km as number) ?? null,
  }));
  const efficiency = buildEfficiencySummary(efRuns, userDateStr());
  if (!efficiency.current) {
    gaps.push('Not enough eligible runs for an efficiency reading — the "is training working" signal is unavailable.');
  } else if (!efficiency.seasonBaseline) {
    gaps.push('No season-matched efficiency baseline (same period one year back) — do not substitute another time of year.');
  }

  // ---- decoupling ---------------------------------------------------------
  const allDc = ((dcHistoryRes.data ?? []) as { decoupling_pct: number | null }[])
    .map((r) => r.decoupling_pct)
    .filter((v): v is number => typeof v === 'number');
  const recentDc = runs.map((r) => r.decoupling_pct).filter((v): v is number => typeof v === 'number');
  const recentMedian = medianOf(recentDc);
  const decoupling: DecouplingState = {
    allTimeMedian: medianOf(allDc),
    recentMedian,
    recentPercentile: recentMedian !== null ? percentileOf(recentMedian, allDc) : null,
    measuredRuns: recentDc.length,
  };
  if (recentDc.length === 0) {
    gaps.push('No decoupling values in the window — aerobic durability cannot be judged.');
  }

  // ---- load ---------------------------------------------------------------
  const latestLoad = [...wellness].reverse().find((w) => w.ctl != null || w.atl != null) ?? null;
  const load: LoadState = {
    ctl: latestLoad?.ctl ?? null,
    atl: latestLoad?.atl ?? null,
    form:
      typeof latestLoad?.ctl === 'number' && typeof latestLoad?.atl === 'number'
        ? Math.round((latestLoad.ctl - latestLoad.atl) * 10) / 10
        : null,
  };
  if (load.ctl === null) gaps.push('No CTL/ATL in the last 7 days — training load trend unavailable.');

  if (!plan) gaps.push('No active training plan — nothing to compare execution against.');

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    weeks,
    volumeKm,
    vertM,
    adherence,
    efficiency,
    decoupling,
    load,
    readiness,
    climb,
    activePlan: plan,
    injuryHistory: profile?.injury_history ?? null,
    gaps,
  };
}

/**
 * Render the state for a prompt.
 *
 * Deliberately states absences as loudly as measurements. A model given a
 * tidy list of numbers with the gaps omitted will reason as though the picture
 * is complete, which is how a confident adjustment gets built on four runs.
 */
export function formatTrainingState(s: TrainingState): string {
  const lines: string[] = ['## TRAINING STATE', `Window: last ${s.windowDays} days, ${s.weeks.length} weeks with runs.`];

  const wk = (t: TrendState, unit: string) =>
    t.recent === null
      ? 'not enough weeks to compare'
      : `${t.recent.toFixed(0)}${unit}/wk recent vs ${t.prior?.toFixed(0)}${unit} prior — ${t.direction}` +
        (t.pctChange !== null ? ` (${t.pctChange > 0 ? '+' : ''}${t.pctChange.toFixed(0)}%)` : '');

  const partial = s.weeks.find((w) => w.isPartial);
  if (partial) {
    lines.push(
      `This week (${partial.weekStart}) is IN PROGRESS — ${partial.runs} run(s), ${partial.km} km so far. ` +
        `Excluded from every trend below; do not read it as a finished week.`,
    );
  }
  lines.push(`- Volume: ${wk(s.volumeKm, ' km')}`);
  lines.push(`- Vert: ${s.vertM.recent === null ? 'not measurable' : wk(s.vertM, ' m')}`);

  if (s.adherence.rate !== null) {
    lines.push(
      `- Adherence: ${s.adherence.runsOnPlannedDays}/${s.adherence.totalRuns} runs on stated training days ` +
        `(${(s.adherence.rate * 100).toFixed(0)}%). Stated: ${s.adherence.plannedDays?.join(', ')}. ` +
        `Actual by day: ${WEEKDAYS.filter((d) => s.adherence.actualDayCounts[d] > 0)
          .map((d) => `${d.slice(0, 3)} ${s.adherence.actualDayCounts[d]}`)
          .join(' · ')}`,
    );
  }

  if (s.efficiency.current) {
    lines.push(
      `- Aerobic efficiency: median ${s.efficiency.current.median.toFixed(2)} (n=${s.efficiency.current.n})` +
        (s.efficiency.pctVsBaseline !== null
          ? `, ${s.efficiency.pctVsBaseline > 0 ? '+' : ''}${s.efficiency.pctVsBaseline.toFixed(1)}% vs the same period last year`
          : ', no season-matched baseline'),
    );
  }

  if (s.decoupling.recentMedian !== null) {
    lines.push(
      `- Decoupling: recent median ${s.decoupling.recentMedian.toFixed(1)}% ` +
        `(his own all-time median ${s.decoupling.allTimeMedian?.toFixed(1)}%` +
        (s.decoupling.recentPercentile !== null ? `, ${s.decoupling.recentPercentile.toFixed(0)}th percentile of his history` : '') +
        `, n=${s.decoupling.measuredRuns}). Percentile against himself — never Friel's bands.`,
    );
  }

  if (s.load.ctl !== null) {
    lines.push(`- Load: CTL ${s.load.ctl.toFixed(1)}, ATL ${s.load.atl?.toFixed(1) ?? '?'}, form ${s.load.form ?? '?'}`);
  }

  if (s.readiness) {
    lines.push(`- Readiness today: ${s.readiness.readiness.verdict} — ${s.readiness.readiness.reasons.join(' ')}`);
  }

  if (s.climb.measuredRuns > 0) {
    lines.push(
      `- Climbing baseline: median ${s.climb.medianVertPerKm?.toFixed(1)} m/km, steepest ${s.climb.maxVertPerKm?.toFixed(1)} m/km, ` +
        `biggest single climb ${s.climb.maxGainM} m, ~${s.climb.avgWeeklyGainM} m/week (n=${s.climb.measuredRuns}).`,
    );
  }

  if (s.injuryHistory) lines.push(`- Injury history: ${s.injuryHistory}`);

  if (s.gaps.length > 0) {
    lines.push('', '**WHAT COULD NOT BE MEASURED** — treat these as unknown, never as "fine":');
    for (const g of s.gaps) lines.push(`- ${g}`);
  }

  return lines.join('\n');
}
