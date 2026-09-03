import { supabase } from './supabase';
import { nowInUserTz, dateInUserTz } from '@/lib/utils/user-time';
import type { Run, Lap } from './types';

/**
 * Get all runs for a user, sorted by date descending
 */
export async function getUserRuns(userId: string, limit = 100): Promise<Run[]> {
  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get runs from the last N days
 */
export async function getRecentRuns(userId: string, days = 14): Promise<Run[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate.toISOString())
    .order('date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get runs from the last N days WITH laps attached for quality workouts.
 * Quality = intervals/tempo/fartlek/long run, or any run with >15% time in Z4+.
 * Easy/recovery runs skip the lap pull to save tokens & bandwidth.
 */
const QUALITY_RUN_TYPES = new Set([
  'Intervals', 'Tempo', 'Fartlek', 'Long Run', 'Race', 'Threshold', 'VO2max',
  // Climb sessions earn their laps for the same reason intervals do: the
  // per-lap detail is the only place the climbing shows up. A 500 m session
  // total says nothing about whether it was one sustained ascent or six reps,
  // and laps carry elevation_gain_m to answer exactly that.
  'Vert / Hill', 'Trail Long Run',
]);

function isQualityRun(run: Run): boolean {
  if (run.run_type && QUALITY_RUN_TYPES.has(run.run_type)) return true;
  const z4plus = (run.pct_z4 ?? 0) + (run.pct_z5 ?? 0) + (run.pct_z6 ?? 0);
  return z4plus > 15;
}

export async function getRecentRunsWithLaps(
  userId: string,
  days = 14,
): Promise<(Run & { laps?: Lap[] })[]> {
  const runs = await getRecentRuns(userId, days);
  if (runs.length === 0) return [];

  const qualityRunIds = runs.filter(isQualityRun).map(r => r.id);
  if (qualityRunIds.length === 0) return runs;

  const { data: laps, error } = await supabase
    .from('laps')
    .select('*')
    .in('run_id', qualityRunIds)
    .order('lap_number', { ascending: true });

  if (error) {
    // Laps are an enrichment, not a hard requirement — fall back gracefully.
    return runs;
  }

  const lapsByRun = new Map<string, Lap[]>();
  for (const lap of laps || []) {
    const arr = lapsByRun.get(lap.run_id) || [];
    arr.push(lap);
    lapsByRun.set(lap.run_id, arr);
  }

  return runs.map(r => ({ ...r, laps: lapsByRun.get(r.id) }));
}

/**
 * Get a single run by ID
 */
export async function getRunById(runId: string): Promise<Run | null> {
  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a new run
 */
export async function createRun(run: Omit<Run, 'id' | 'created_at'>): Promise<Run> {
  const { data, error } = await supabase
    .from('runs')
    .insert(run)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a run
 */
export async function updateRun(runId: string, updates: Partial<Run>): Promise<Run> {
  const { data, error } = await supabase
    .from('runs')
    .update(updates)
    .eq('id', runId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a run
 */
export async function deleteRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('runs')
    .delete()
    .eq('id', runId);

  if (error) throw error;
}

/**
 * Get total distance for a user
 */
export async function getTotalDistance(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('runs')
    .select('distance_km')
    .eq('user_id', userId);

  if (error) throw error;
  return (data || []).reduce((sum, run) => sum + (run.distance_km || 0), 0);
}

/**
 * Get this week's runs and stats
 */
export async function getThisWeekStats(userId: string): Promise<{ runs: Run[]; totalKm: number }> {
  // Sunday-anchored week in the USER's timezone — matches the training
  // plan's Sun-Sat structure. (Previously Mon-based, then server-UTC-based;
  // both mis-bucketed edge runs.)
  const now = nowInUserTz();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .gte('date', sunday.toISOString())
    .order('date', { ascending: false });

  if (error) throw error;

  const runs = data || [];
  const totalKm = runs.reduce((sum, run) => sum + (run.distance_km || 0), 0);

  return { runs, totalKm };
}

/**
 * Get weekly volume for the last N weeks
 */
export async function getWeeklyVolume(userId: string, weeks = 12): Promise<{ week: string; km: number }[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - weeks * 7);

  const { data, error } = await supabase
    .from('runs')
    .select('date, distance_km')
    .eq('user_id', userId)
    .gte('date', startDate.toISOString())
    .order('date', { ascending: true });

  if (error) throw error;

  // Group by week
  const weeklyData: Record<string, number> = {};

  (data || []).forEach((run) => {
    // Evaluate the run's calendar date in the user's timezone before
    // bucketing — a 00:30 Sunday IL run is Saturday 21:30 UTC and would
    // otherwise land in the previous week.
    const date = dateInUserTz(new Date(run.date));
    const weekStart = new Date(date);
    const dayOfWeek = weekStart.getDay();
    weekStart.setDate(date.getDate() - dayOfWeek);
    const weekKey = weekStart.toISOString().split('T')[0];

    weeklyData[weekKey] = (weeklyData[weekKey] || 0) + (run.distance_km || 0);
  });

  return Object.entries(weeklyData).map(([week, km]) => ({
    week,
    km: Math.round(km * 10) / 10,
  }));
}

/**
 * The athlete's measured climbing history, for grounding a plan's vert
 * prescription in what he has actually done.
 *
 * Exists because the alternative is the model inventing a starting point. Ask
 * an LLM to build toward 1300 m without telling it where the athlete is and it
 * will produce a plausible-looking ramp anchored to nothing — and this athlete's
 * real position is unusual enough that a generic ramp would be wrong in both
 * directions at once: he has the aerobic base for the distance and has never
 * run anything near the gradient.
 *
 * `measuredRuns` travels with the numbers so the caller can say how much
 * history is behind them. Elevation exists on a minority of rows, and a median
 * drawn from 4 runs must not read like one drawn from 128 — the mistake this
 * codebase has made with an n=1 season baseline and a two-sample median before.
 */
export interface ClimbBaseline {
  measuredRuns: number;
  medianVertPerKm: number | null;
  maxVertPerKm: number | null;
  /** Largest single-run climb, metres. */
  maxGainM: number | null;
  /** Mean weekly climb over the window, metres. Null when nothing was measured. */
  avgWeeklyGainM: number | null;
}

export async function getClimbBaseline(userId: string, days = 120): Promise<ClimbBaseline> {
  const empty: ClimbBaseline = {
    measuredRuns: 0, medianVertPerKm: null, maxVertPerKm: null,
    maxGainM: null, avgWeeklyGainM: null,
  };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('runs')
    .select('elevation_gain_m,vert_per_km')
    .eq('user_id', userId)
    .gte('date', since)
    .not('elevation_gain_m', 'is', null);

  if (error || !data || data.length === 0) return empty;

  const rows = data as { elevation_gain_m: number | null; vert_per_km: number | null }[];
  const gradients = rows
    .map((r) => r.vert_per_km)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  const gains = rows
    .map((r) => r.elevation_gain_m)
    .filter((v): v is number => typeof v === 'number');

  if (gains.length === 0) return empty;

  const totalGain = gains.reduce((sum, g) => sum + g, 0);
  return {
    measuredRuns: gains.length,
    medianVertPerKm: gradients.length ? gradients[Math.floor(gradients.length / 2)] : null,
    maxVertPerKm: gradients.length ? gradients[gradients.length - 1] : null,
    maxGainM: Math.max(...gains),
    avgWeeklyGainM: Math.round(totalGain / (days / 7)),
  };
}
