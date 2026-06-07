/**
 * Plan-generation context builder.
 *
 * Default RAG context (used by chat) only sees the last 14 days. For plan
 * generation, the model needs a much wider view:
 *   - 90-day run history (current capabilities, weekly volume trend)
 *   - Lifetime PRs across standard distances (who is this runner?)
 *   - Last 2-3 plans + their outcomes (what was the trajectory?)
 *   - Athlete intake fields from the form (race date, current vol, what
 *     to address, limitations)
 *
 * This module fetches and formats all of that into a single markdown
 * block that the plan-gen prompt prepends. Pure server-side; no LLM.
 */

import { supabase } from '@/lib/db/supabase';
import { getActivePlan } from '@/lib/db/plans';
import type { Run, TrainingPlan } from '@/lib/db/types';

export interface PlanGenIntake {
  /** ISO date of the target race (preferred over a free string). */
  raceDate?: string;
  /** Target time in MM:SS or HH:MM:SS, e.g. "52:00" for 10K. */
  targetTime?: string;
  /** Free-text recent race or time trial summary. */
  recentRaceResult?: string;
  /** Current avg weekly km (auto-suggested from last 4 weeks). */
  currentWeeklyKm?: number;
  /** What this plan should specifically address — coach's prompt. */
  addressesWhat?: string;
  /** Constraints to respect (injury, schedule, methodology, equipment). */
  limitations?: string;
}

export interface PlanGenContext {
  /** Markdown block to inject into the prompt under "## PLAN GENERATION INTAKE". */
  intakeBlock: string;
  /** Tokens used (rough). */
  tokenCount: number;
  /** Stats the API can echo back in metadata. */
  stats: {
    runsAnalyzedDays: number;
    runsAnalyzedCount: number;
    avgWeeklyKm: number | null;
    longestRunKm: number | null;
    prCount: number;
    pastPlansCount: number;
    hasPriorPlan: boolean;
  };
}

const CHARS_PER_TOKEN = 4;

export async function buildPlanGenerationContext(
  userId: string,
  intake: PlanGenIntake = {},
): Promise<PlanGenContext> {
  // Pull 90 days of runs + last 5 plans + active plan in parallel.
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const [runsRes, pastPlansRes, active] = await Promise.all([
    supabase
      .from('runs')
      .select('id, date, distance_km, duration_min, avg_pace_str, avg_pace_min_km, run_type, workout_name, avg_hr')
      .eq('user_id', userId)
      .gte('date', since.toISOString())
      .order('date', { ascending: false })
      .limit(200),
    supabase
      .from('training_plans')
      .select('id, plan_type, plan_json, duration_weeks, start_date, current_week_num, status, created_at')
      .eq('user_id', userId)
      .in('status', ['completed', 'archived', 'active'])
      .order('created_at', { ascending: false })
      .limit(5),
    getActivePlan(userId),
  ]);

  const runs90d: RunRow[] = (runsRes.data || []) as RunRow[];
  const pastPlans: PastPlan[] = ((pastPlansRes.data || []) as PastPlan[]).filter(
    p => p.id !== active?.id,
  );

  // ── Stats ────────────────────────────────────────────────────────────
  const weeklyKmByWeek = aggregateWeeklyKm(runs90d);
  const avgWeeklyKm = weeklyKmByWeek.length
    ? round1(weeklyKmByWeek.reduce((s, w) => s + w.km, 0) / weeklyKmByWeek.length)
    : null;
  const longestRunKm = runs90d.length
    ? round1(Math.max(...runs90d.map(r => r.distance_km || 0)))
    : null;
  const prs = computePRs(runs90d);

  // ── Format the intake block ──────────────────────────────────────────
  const lines: string[] = [];
  lines.push('## PLAN GENERATION INTAKE');
  lines.push('');
  lines.push('This block holds everything you (the model) need beyond the standard 3-layer RAG context. Use it as the primary anchor when structuring volume, intensity, and progression.');
  lines.push('');

  // Form-level intake first
  const intakeLines: string[] = [];
  if (intake.raceDate) intakeLines.push(`- Target race date: ${intake.raceDate}`);
  if (intake.targetTime) intakeLines.push(`- Target time: ${intake.targetTime}`);
  if (intake.currentWeeklyKm != null) intakeLines.push(`- Athlete-reported current weekly volume: ${intake.currentWeeklyKm} km`);
  if (intake.recentRaceResult) intakeLines.push(`- Recent race / time trial: ${intake.recentRaceResult}`);
  if (intake.addressesWhat) intakeLines.push(`- What this plan should address: ${intake.addressesWhat}`);
  if (intake.limitations) intakeLines.push(`- Limitations to respect: ${intake.limitations}`);
  if (intakeLines.length > 0) {
    lines.push('### Athlete intake (from the form)');
    lines.push(...intakeLines);
    lines.push('');
  }

  // 90-day stats
  lines.push('### Last 90 days at a glance');
  lines.push(`- Total runs: ${runs90d.length}`);
  if (avgWeeklyKm != null) lines.push(`- Average weekly volume: **${avgWeeklyKm} km/week** (computed from logged runs)`);
  if (longestRunKm != null) lines.push(`- Longest single run: **${longestRunKm} km**`);
  if (weeklyKmByWeek.length > 0) {
    const trend = weeklyKmByWeek.slice(-8).map(w => `${w.weekStart}: ${round1(w.km)}km`).join(' · ');
    lines.push(`- Recent weekly volumes (most recent 8 weeks): ${trend}`);
  }
  lines.push('');

  // PRs / fastest efforts
  if (prs.length > 0) {
    lines.push('### Lifetime-best efforts at standard distances (within last 90d window)');
    for (const pr of prs) {
      lines.push(`- ${pr.distance}: ${pr.paceStr} (${pr.run_date}, total ${round1(pr.distance_km)}km)`);
    }
    lines.push('');
  }

  // Prior plan context
  if (pastPlans.length > 0) {
    const lastPlan = pastPlans[0];
    lines.push('### Continuing from previous plan(s)');
    lines.push(`Most recent prior plan: **${lastPlan.plan_json?.plan_name || lastPlan.plan_type}** (${lastPlan.duration_weeks}w, status=${lastPlan.status}, started ${lastPlan.start_date || '?'}).`);
    if (lastPlan.plan_json?.goal) lines.push(`- Prior plan goal: ${lastPlan.plan_json.goal}`);
    if (lastPlan.plan_json?.methodology) lines.push(`- Prior methodology: ${lastPlan.plan_json.methodology}`);

    // Outcome summary: how much of the prior plan did they actually execute?
    if (lastPlan.start_date) {
      const outcome = await summarizePlanOutcome(userId, lastPlan);
      if (outcome) {
        lines.push(`- Execution outcome: ${outcome}`);
      }
    }
    lines.push('');

    if (pastPlans.length > 1) {
      const earlier = pastPlans.slice(1, 3).map(p => `${p.plan_json?.plan_name || p.plan_type} (${p.duration_weeks}w, ${p.status})`).join('; ');
      lines.push(`Earlier plans: ${earlier}.`);
      lines.push('');
    }

    lines.push('Build this new plan as a **continuation**: assume the athlete arrives with the fitness implied by the prior plan\'s outcome, not from zero. If a transition (different distance, different methodology) is implied by the new parameters, structure the first 1-2 weeks as a deliberate handoff before the new phase work begins.');
    lines.push('');
  } else {
    lines.push('### Plan history');
    lines.push('No prior plans on record — treat this as a first plan.');
    lines.push('');
  }

  // Coaching instruction tail
  lines.push('### How to use this block');
  lines.push('- Anchor volume on the athlete-reported (or computed) current weekly km — never prescribe a Week 1 that\'s >10% above current.');
  lines.push('- Use the 90-day longest run as the realistic upper bound for the first long-run target.');
  lines.push('- If lifetime-best efforts are listed, calibrate pace zones from those rather than book defaults.');
  lines.push('- Honor every limitation listed verbatim, even if it conflicts with methodology defaults.');

  const intakeBlock = lines.join('\n');
  return {
    intakeBlock,
    tokenCount: Math.ceil(intakeBlock.length / CHARS_PER_TOKEN),
    stats: {
      runsAnalyzedDays: 90,
      runsAnalyzedCount: runs90d.length,
      avgWeeklyKm,
      longestRunKm,
      prCount: prs.length,
      pastPlansCount: pastPlans.length,
      hasPriorPlan: pastPlans.length > 0,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

interface RunRow {
  id: string;
  date: string;
  distance_km: number;
  duration_min?: number;
  avg_pace_str?: string;
  avg_pace_min_km?: number;
  run_type?: string;
  workout_name?: string;
  avg_hr?: number;
}

interface PastPlan {
  id: string;
  plan_type: string;
  plan_json: TrainingPlan['plan_json'];
  duration_weeks: number;
  start_date?: string;
  current_week_num: number;
  status: string;
  created_at: string;
}

function round1(n: number | null | undefined): number {
  if (n == null) return 0;
  return Math.round(n * 10) / 10;
}

function aggregateWeeklyKm(runs: RunRow[]): { weekStart: string; km: number }[] {
  const byWeek = new Map<string, number>();
  for (const r of runs) {
    const d = new Date(r.date);
    const day = d.getDay();
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);
    const key = sunday.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) || 0) + (r.distance_km || 0));
  }
  return Array.from(byWeek.entries())
    .map(([weekStart, km]) => ({ weekStart, km }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

interface PRRow {
  distance: string;
  distance_km: number;
  paceStr: string;
  run_date: string;
}

/**
 * Find the fastest effort whose total distance was within 5% of each
 * standard race distance. Approximates "race PRs" without needing a
 * dedicated race column.
 */
function computePRs(runs: RunRow[]): PRRow[] {
  const targets = [
    { label: '5K', km: 5 },
    { label: '10K', km: 10 },
    { label: 'Half', km: 21.1 },
    { label: 'Marathon', km: 42.2 },
  ];

  const out: PRRow[] = [];
  for (const t of targets) {
    const candidates = runs
      .filter(r => {
        const d = r.distance_km || 0;
        return d >= t.km * 0.95 && d <= t.km * 1.1;
      })
      .filter(r => (r.avg_pace_min_km || 0) > 0);

    if (candidates.length === 0) continue;
    candidates.sort((a, b) => (a.avg_pace_min_km || 999) - (b.avg_pace_min_km || 999));
    const best = candidates[0];
    out.push({
      distance: t.label,
      distance_km: best.distance_km,
      paceStr: best.avg_pace_str || `${(best.avg_pace_min_km || 0).toFixed(2)} min/km`,
      run_date: best.date.slice(0, 10),
    });
  }
  return out;
}

async function summarizePlanOutcome(userId: string, plan: PastPlan): Promise<string | null> {
  if (!plan.start_date) return null;
  const end = new Date(plan.start_date);
  end.setDate(end.getDate() + plan.duration_weeks * 7);

  const { data } = await supabase
    .from('runs')
    .select('distance_km, date')
    .eq('user_id', userId)
    .gte('date', plan.start_date)
    .lte('date', end.toISOString());

  const rows = (data || []) as { distance_km: number; date: string }[];
  if (rows.length === 0) return 'No runs logged during this plan window.';

  const total = rows.reduce((s, r) => s + (r.distance_km || 0), 0);
  const weeks = plan.duration_weeks;
  const avgWk = weeks ? total / weeks : 0;
  return `${rows.length} runs logged · ${round1(total)} total km · ${round1(avgWk)} km/week average across the ${weeks}-week plan.`;
}
