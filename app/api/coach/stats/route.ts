import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, getSundayOfWeek } from '@/lib/utils/week-calculator';
import { nowInUserTz, userDateStrDaysAgo } from '@/lib/utils/user-time';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { getRecentFeedback, getWeeklySummary, getCurrentWeekStart } from '@/lib/db/feedback';
import { calculateFatigueScore } from '@/lib/rag/user-formatter';
import { sumVert, vertPerKm } from '@/lib/utils/elevation';
import { readinessForUser } from '@/lib/coach/readiness-service';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    // Week boundary (Sunday, user timezone — server is UTC)
    const now = nowInUserTz();
    const sunday = getSundayOfWeek(now);

    // All three fetches are independent — run together. Lifetime totals
    // come from a Postgres aggregate RPC (runcoach.run_totals): the route
    // previously pulled EVERY runs row to sum distance in JS, a payload
    // that grew forever with training history.
    const yesterday36h = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const [totalsRes, weekRes, planRes, feedback, weeklySummary, lastRunRes] = await Promise.all([
      supabase.rpc('run_totals', { p_user_id: userId }),
      supabase
        .from('runs')
        .select('distance_km,elevation_gain_m')
        .eq('user_id', userId)
        .gte('date', sunday.toISOString()),
      supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
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

    const totalsRow = (totalsRes.data as { total_runs: number; total_km: number }[] | null)?.[0];
    const totalRuns = Number(totalsRow?.total_runs ?? 0);
    const totalDistanceKm = Number(totalsRow?.total_km ?? 0);

    const weekData = weekRes.data;
    const thisWeekKm = (weekData || []).reduce(
      (sum, run) => sum + (run.distance_km || 0), 0
    );
    const thisWeekRuns = weekData?.length || 0;

    // Weekly climb. `measuredRuns` travels with the total because elevation
    // exists on a minority of rows: a week mixing measured and unmeasured runs
    // has a total that is a FLOOR, and the tile has to be able to say so
    // rather than presenting it as the week's climbing. Null when nothing was
    // measured — "we cannot see the climbing" is not "you climbed nothing".
    const weekVert = sumVert((weekData || []) as { elevation_gain_m?: number | null }[]);
    const weeklyVert =
      weekVert.measured === 0
        ? null
        : {
            gainM: Math.round(weekVert.totalM),
            measuredRuns: weekVert.measured,
            totalRuns: weekVert.total,
            vertPerKm: vertPerKm(weekVert.totalM, thisWeekKm),
          };

    const activePlan = planRes.data;

    // Calculate current week for the active plan
    let planWithWeekInfo = activePlan;
    if (activePlan) {
      // Use start_date if available, otherwise fallback to created_at
      const startDate = activePlan.start_date || (activePlan.created_at ? activePlan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
      const weekInfo = calculateCurrentWeek(startDate, activePlan.duration_weeks);
      planWithWeekInfo = {
        ...activePlan,
        current_week_num: weekInfo.currentWeek,
        isAfterEnd: weekInfo.isAfterEnd,
      };
    }

    // Deterministic readiness verdict (GO / EASY / REST). Assembled by
    // `readinessForUser` so the dashboard badge and the weekly scorecard row
    // are literally the same computation — two assemblies of the same inputs
    // would eventually disagree, which is what the deterministic verdict
    // exists to prevent.
    const { readiness, fatigueScore, recoveryAgeDays, recovery } = await readinessForUser(userId, planWithWeekInfo || null);

    // ── Dashboard tiles ────────────────────────────────────────────────
    // Each is independent and best-effort: a gap in one must render as
    // "--" on that tile rather than failing the whole dashboard.

    const plannedWeek = plannedVolumeForCurrentWeek(planWithWeekInfo);
    const fitness = await fitnessTrend(userId);
    const loadRamp = await loadRampTrend(userId);

    return NextResponse.json({
      totalRuns: totalRuns || 0,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      thisWeekKm: Math.round(thisWeekKm * 10) / 10,
      thisWeekRuns,
      activePlan: planWithWeekInfo || null,
      readiness: { ...readiness, fatigueScore },

      /** Planned side of the This Week tile. Null when there is no active plan. */
      plannedWeek,
      /** CTL now vs 28 days ago. */
      fitness,
      /** Latest HRV against baseline, plus sleep. */
      recoveryTile: recovery
        ? {
            hrv: recovery.hrv ?? null,
            hrvBaseline: recovery.hrvBaseline ?? null,
            hrvDelta:
              typeof recovery.hrv === 'number' && typeof recovery.hrvBaseline === 'number'
                ? Math.round((recovery.hrv - recovery.hrvBaseline) * 10) / 10
                : null,
            sleepHours:
              typeof recovery.sleepSecs === 'number'
                ? Math.round((recovery.sleepSecs / 3600) * 10) / 10
                : null,
            sleepScore: recovery.sleepScore ?? null,
            ageDays: recoveryAgeDays,
          }
        : null,
      /** 7-day TRIMP against the trailing 28-day weekly average. */
      loadRamp,
      /**
       * Weekly climb, or null when no run this week carried an elevation
       * reading. Never 0 as a stand-in for unmeasured.
       */
      weeklyVert,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tile helpers. Each returns null rather than a zero when the data is
// absent, so the UI can say "--" instead of asserting something false.
// ─────────────────────────────────────────────────────────────────────────

interface PlannedWeek {
  km: number | null;
  sessions: number;
}

/** Matches a rest day in a plan's free-text workout type. */
const REST_WORKOUT = /rest|off/i;

interface PlanWorkoutLike {
  type?: string;
  /** Free text from AI generation, e.g. "15 km" or "6.5 km". */
  distance?: string;
}

interface PlanWeekLike {
  week_number?: number;
  /** Keyed by day name ("Monday"), NOT an array. */
  workouts?: Record<string, PlanWorkoutLike>;
}

/** "15 km" -> 15. Returns null for time-only prescriptions like "45 min". */
function parsePlannedKm(distance: string | undefined): number | null {
  if (!distance) return null;
  const match = /([\d.]+)\s*k/i.exec(distance);
  return match ? Number.parseFloat(match[1]) : null;
}

/**
 * Planned distance and session count for the plan's CURRENT week.
 *
 * Two shape details the plan JSON actually has, both easy to get wrong:
 * `workouts` is an object keyed by day name rather than an array, and
 * `distance` is free text ("15 km") rather than a number.
 *
 * Looks the week up by `week_number` rather than array position, and uses the
 * week already derived from `start_date` via `calculateCurrentWeek` — not the
 * stored `current_week_num`, which reads 1 here while the athlete is in week 9.
 */
function plannedVolumeForCurrentWeek(
  plan: { current_week_num?: number; plan_json?: { weeks?: PlanWeekLike[] } } | null,
): PlannedWeek | null {
  const weekNum = plan?.current_week_num;
  const weeks = plan?.plan_json?.weeks;
  if (!weekNum || !Array.isArray(weeks)) return null;

  const week = weeks.find((w) => w.week_number === weekNum) ?? weeks[weekNum - 1];
  const workouts = week?.workouts;
  if (!workouts || typeof workouts !== 'object') return null;

  const sessions = Object.values(workouts).filter((w) => w && !REST_WORKOUT.test(w.type ?? ''));
  if (sessions.length === 0) return null;

  const km = sessions.reduce((sum, w) => sum + (parsePlannedKm(w.distance) ?? 0), 0);

  return {
    // A week can prescribe sessions by time alone; report the count and leave
    // volume unknown rather than claiming 0 km.
    km: km > 0 ? Math.round(km * 10) / 10 : null,
    sessions: sessions.length,
  };
}

interface FitnessTrend {
  ctl: number | null;
  ctlPrior: number | null;
  delta: number | null;
}

/** CTL now versus 28 days ago — the base-building athlete's key number. */
async function fitnessTrend(userId: string): Promise<FitnessTrend> {
  try {
    const [latestRes, priorRes] = await Promise.all([
      supabase
        .from('daily_wellness')
        .select('ctl')
        .eq('user_id', userId)
        .not('ctl', 'is', null)
        .order('day', { ascending: false })
        .limit(1),
      supabase
        .from('daily_wellness')
        .select('ctl')
        .eq('user_id', userId)
        .not('ctl', 'is', null)
        .lte('day', userDateStrDaysAgo(28))
        .order('day', { ascending: false })
        .limit(1),
    ]);

    const ctl = (latestRes.data?.[0]?.ctl as number | undefined) ?? null;
    const ctlPrior = (priorRes.data?.[0]?.ctl as number | undefined) ?? null;

    return {
      ctl: ctl === null ? null : Math.round(ctl * 10) / 10,
      ctlPrior: ctlPrior === null ? null : Math.round(ctlPrior * 10) / 10,
      delta: ctl !== null && ctlPrior !== null ? Math.round((ctl - ctlPrior) * 10) / 10 : null,
    };
  } catch {
    return { ctl: null, ctlPrior: null, delta: null };
  }
}

interface LoadRamp {
  last7: number | null;
  weeklyAvg28: number | null;
  pctChange: number | null;
}

/** Minimum history before a ramp figure means anything. */
const MIN_RAMP_HISTORY_DAYS = 21;

/**
 * Last 7 days of TRIMP against the trailing 28-day weekly average.
 *
 * Returns nulls below three weeks of history: with less, the 28-day mean is
 * dominated by whatever days happen to exist and the percentage swings wildly
 * for reasons that have nothing to do with training.
 */
async function loadRampTrend(userId: string): Promise<LoadRamp> {
  const empty = { last7: null, weeklyAvg28: null, pctChange: null };
  try {
    const { data } = await supabase
      .from('runs')
      .select('date,trimp')
      .eq('user_id', userId)
      .not('trimp', 'is', null)
      .gte('date', `${userDateStrDaysAgo(28)}T00:00:00Z`);

    const rows = (data ?? []) as { date: string; trimp: number }[];
    if (rows.length === 0) return empty;

    const oldest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    const historyDays = (Date.now() - Date.parse(oldest)) / 86_400_000;
    if (historyDays < MIN_RAMP_HISTORY_DAYS) return empty;

    const sevenDaysAgo = `${userDateStrDaysAgo(7)}T00:00:00Z`;
    const last7 = rows.filter((r) => r.date >= sevenDaysAgo).reduce((s, r) => s + r.trimp, 0);
    const weeklyAvg28 = rows.reduce((s, r) => s + r.trimp, 0) / 4;
    if (weeklyAvg28 <= 0) return empty;

    return {
      last7: Math.round(last7),
      weeklyAvg28: Math.round(weeklyAvg28),
      pctChange: Math.round(((last7 - weeklyAvg28) / weeklyAvg28) * 100),
    };
  } catch {
    return empty;
  }
}
