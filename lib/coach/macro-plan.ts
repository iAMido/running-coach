/**
 * The season layer: phases, targets, and the criteria for moving between them.
 *
 * ## Why a macro plan holds no workouts
 *
 * Measured on this app's own output, a plan-week costs ~623 output tokens. An
 * 11-month day-by-day plan is ~30k against a 16k ceiling, so it cannot be
 * generated in one call — but that is the smaller objection. The real one is
 * that a prescribed session for July 2027 is fiction. It will be invalidated by
 * the first real climbing block, an illness, or simply by how the athlete
 * adapts, and a plan that is wrong in its details teaches you to ignore it.
 *
 * So this layer holds **intent and targets**; `training_plans` rows hang off it
 * as 8-16 week blocks carrying actual sessions.
 *
 * ## Exit criteria are the point
 *
 * Each phase declares what must be TRUE to leave it, not merely how long it
 * lasts. A phase ends when its criterion is met; if it is not met, the phase
 * extends. That makes the season adaptive by construction rather than by
 * re-prompting a model every few weeks and hoping it stays coherent — and it
 * means a slow adapter gets more base instead of being marched into a build
 * phase he is not ready for.
 *
 * Criteria must be checkable against `TrainingState`. A criterion nothing can
 * measure is a wish, and this codebase has enough of those recorded already.
 */

import { supabase } from '@/lib/db/supabase';

export interface MacroPhase {
  phase_number: number;
  name: string;
  focus: string;
  /** Planned length. A phase may run longer if its exit criteria are unmet. */
  weeks: number;
  weekly_km_range: [number, number] | null;
  /** Null for a plan with no elevation goal — never [0,0], which reads as "flat on purpose". */
  weekly_vert_range_m: [number, number] | null;
  long_run_vert_ceiling_m: number | null;
  /** The capability this phase exists to build, in plain language. */
  capability: string;
  /** What must be true to advance. Each must be checkable against TrainingState. */
  exit_criteria: string[];
  key_sessions: string[];
}

export interface MacroPlan {
  id: string;
  user_id: string;
  goal_name: string;
  race_date: string | null;
  race_distance_km: number | null;
  race_elevation_gain_m: number | null;
  terrain_access: string | null;
  horizon_weeks: number;
  phases: MacroPhase[];
  rationale: string | null;
  status: 'active' | 'superseded' | 'completed';
  revision: number;
  supersedes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getActiveMacroPlan(userId: string): Promise<MacroPlan | null> {
  const { data, error } = await supabase
    .from('macro_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('macro-plan: fetch failed:', error.message);
    return null;
  }
  return (data as MacroPlan) ?? null;
}

/**
 * Store a new macro plan, superseding any active one.
 *
 * A revision is a NEW ROW, never an edit. The old season is kept and marked
 * superseded so "why did my plan change in October" stays answerable six
 * months later — the same reason `training_plans` keeps completed rows.
 */
export async function saveMacroPlan(
  userId: string,
  plan: Omit<MacroPlan, 'id' | 'user_id' | 'status' | 'revision' | 'supersedes' | 'created_at' | 'updated_at'>,
): Promise<MacroPlan | null> {
  const previous = await getActiveMacroPlan(userId);

  // Supersede first. The partial unique index allows only one active row per
  // user, so inserting before superseding would be rejected.
  if (previous) {
    await supabase.from('macro_plans').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', previous.id);
  }

  const { data, error } = await supabase
    .from('macro_plans')
    .insert({
      user_id: userId,
      goal_name: plan.goal_name,
      race_date: plan.race_date,
      race_distance_km: plan.race_distance_km,
      race_elevation_gain_m: plan.race_elevation_gain_m,
      terrain_access: plan.terrain_access,
      horizon_weeks: plan.horizon_weeks,
      phases: plan.phases,
      rationale: plan.rationale,
      status: 'active',
      revision: (previous?.revision ?? 0) + 1,
      supersedes: previous?.id ?? null,
    })
    .select('*')
    .single();

  if (error) {
    // Put the previous season back rather than leaving the athlete with none.
    if (previous) {
      await supabase.from('macro_plans').update({ status: 'active' }).eq('id', previous.id);
    }
    console.error('macro-plan: save failed:', error.message);
    return null;
  }
  return data as MacroPlan;
}

/**
 * Which phase a given week of the season falls in.
 *
 * Walks the declared lengths. Returns null past the end rather than clamping
 * to the last phase — running off the end of a season is a real state (the
 * race has passed, or the plan needs revising) and must not silently render as
 * "still tapering".
 */
export function phaseForWeek(plan: MacroPlan, weekNumber: number): MacroPhase | null {
  let cursor = 0;
  for (const phase of plan.phases) {
    cursor += phase.weeks;
    if (weekNumber <= cursor) return phase;
  }
  return null;
}

/** Week index (1-based) of the season for a given date, or null before it starts. */
export function seasonWeekFor(plan: MacroPlan, today: string, startDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now < start) return null;
  return Math.floor((now - start) / (7 * 24 * 3600 * 1000)) + 1;
}

/**
 * Render the season for a prompt — used when generating a block, so the block
 * knows what it is FOR, and by the weekly proposal so it can tell a wobble
 * from a phase that has run its course.
 */
export function formatMacroPlan(plan: MacroPlan, currentWeek?: number | null): string {
  const lines: string[] = [
    '## SEASON PLAN (macro)',
    `Goal: ${plan.goal_name}${plan.race_date ? ` on ${plan.race_date}` : ''}`,
    `Horizon: ${plan.horizon_weeks} weeks across ${plan.phases.length} phases.`,
  ];
  if (plan.race_elevation_gain_m && plan.race_distance_km) {
    lines.push(
      `Race profile: ${plan.race_distance_km} km / ${plan.race_elevation_gain_m} m ` +
        `(${(plan.race_elevation_gain_m / plan.race_distance_km).toFixed(1)} m/km).`,
    );
  }

  let cursor = 0;
  for (const p of plan.phases) {
    const from = cursor + 1;
    cursor += p.weeks;
    const isCurrent = currentWeek != null && currentWeek >= from && currentWeek <= cursor;
    lines.push('');
    lines.push(`### Phase ${p.phase_number}: ${p.name} (weeks ${from}-${cursor})${isCurrent ? '  <- CURRENT' : ''}`);
    lines.push(`- Focus: ${p.focus}`);
    lines.push(`- Building: ${p.capability}`);
    if (p.weekly_km_range) lines.push(`- Weekly km: ${p.weekly_km_range[0]}-${p.weekly_km_range[1]}`);
    if (p.weekly_vert_range_m) lines.push(`- Weekly vert: ${p.weekly_vert_range_m[0]}-${p.weekly_vert_range_m[1]} m`);
    if (p.long_run_vert_ceiling_m) lines.push(`- Long-run vert ceiling: ${p.long_run_vert_ceiling_m} m`);
    if (p.key_sessions?.length) lines.push(`- Key sessions: ${p.key_sessions.join('; ')}`);
    lines.push(`- Exit criteria (ALL must hold to advance): ${p.exit_criteria.join(' | ')}`);
  }

  lines.push('');
  lines.push(
    'Phases advance on their EXIT CRITERIA, not on the calendar. If the criteria ' +
      'are unmet the phase extends — say so plainly rather than moving on because the weeks ran out.',
  );
  return lines.join('\n');
}
