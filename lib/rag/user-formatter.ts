import { getRecentRunsWithLaps } from '@/lib/db/runs';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { getRecentFeedback, getWeeklySummary } from '@/lib/db/feedback';
import { getRecentWellness, getWellnessBaselines, type WellnessBaselines } from '@/lib/db/wellness';
import { calculateCurrentWeek, sortWorkoutsByDay } from '@/lib/utils/week-calculator';
import { daysBetweenDateStr, nowInUserTz, userDateStr } from '@/lib/utils/user-time';
import { formatPace } from '@/lib/utils/pace';
import { percentileOf, medianOf } from '@/lib/utils/decoupling';
import { formatZoneDiscipline } from '@/lib/utils/zone-discipline';
import { plannedWorkoutForRunDate } from '@/lib/ai/run-reaction';
import { supabase } from '@/lib/db/supabase';
import type { Run, Lap, RunFeedback, WeeklySummary, AthleteProfile, TrainingPlan, Workout, DailyWellness } from '@/lib/db/types';
import type { FormattedUserContext } from './types';

type RunWithLaps = Run & { laps?: Lap[] };
type FeedbackWithRun = RunFeedback & { run_id?: string | null };

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

/**
 * Format user context for AI consumption
 * Includes recent runs, feedback, profile, and active plan
 */
export interface UserContextPreload {
  /** Pass the plan/profile the route already fetched to skip re-querying.
   *  `null` = checked-and-absent; `undefined` = fetch here. */
  plan?: TrainingPlan | null;
  profile?: AthleteProfile | null;
}

export async function formatUserContext(
  userId: string,
  maxTokens: number,
  preload: UserContextPreload = {},
): Promise<FormattedUserContext> {
  // Fetch all user data in parallel — reusing anything the caller already
  // fetched (previously the plan was queried up to 3x per request across
  // route / context-builder / here).
  const [runsWithLaps, feedback, profile, plan, weeklySummary] = await Promise.all([
    getRecentRunsWithLaps(userId, 14), // Last 14 days, laps attached for quality workouts
    getRecentFeedback(userId, 14),
    preload.profile !== undefined ? Promise.resolve(preload.profile) : getAthleteProfile(userId),
    preload.plan !== undefined ? Promise.resolve(preload.plan) : getActivePlan(userId),
    getLatestWeeklySummary(userId),
  ]);

  // Calculate fatigue score
  const fatigueScore = calculateFatigueScore(feedback, weeklySummary);

  // Determine current week from start_date (authoritative) and current phase
  const liveWeek = plan?.start_date
    ? calculateCurrentWeek(plan.start_date, plan.duration_weeks).currentWeek
    : (plan?.current_week_num || 1);
  const currentPhase = plan?.plan_json?.weeks?.[liveWeek - 1]?.phase || null;

  // Build context sections
  const sections: string[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // 1. Profile (essential, always include)
  if (profile) {
    const profileText = formatProfile(profile);
    sections.push(profileText);
    totalChars += profileText.length;
  }

  // 2. Current training status
  const statusText = formatTrainingStatus(runsWithLaps, fatigueScore, currentPhase);
  sections.push(statusText);
  totalChars += statusText.length;

  // 2b. Recovery. Placed high: it is small, and it changes how the coach should
  // read everything below it. Best-effort — an outage must not cost the rest of
  // the context.
  try {
    const [recentWellness, baselines] = await Promise.all([
      getRecentWellness(userId, 7),
      getWellnessBaselines(userId),
    ]);
    const recoveryText = formatRecovery(recentWellness, baselines);
    if (recoveryText) {
      sections.push(recoveryText);
      totalChars += recoveryText.length;
    }
  } catch (err) {
    console.error('user-formatter: recovery block unavailable:', err);
  }

  // The athlete's own decoupling history, so each run can be placed against it
  // rather than judged by inherited bands. Best-effort.
  let decouplingHistory: number[] = [];
  try {
    decouplingHistory = await getDecouplingHistory(userId);
  } catch {
    decouplingHistory = [];
  }

  // 3. Recent runs (fit as many as possible) — feedback joined inline by run_id or date
  const runsText = formatRecentRuns(
    runsWithLaps,
    feedback as FeedbackWithRun[],
    maxChars - totalChars - 800, // Reserve ~800 chars for plan
    decouplingHistory,
    plan ?? null,
  );
  sections.push(runsText.text);
  totalChars += runsText.text.length;

  // 4. Active plan summary (now includes the current week's per-day workouts)
  if (plan && totalChars < maxChars - 300) {
    const planText = formatActivePlan(plan, liveWeek);
    sections.push(planText);
    totalChars += planText.length;
  }

  // 5. Weekly summary if available
  if (weeklySummary && totalChars < maxChars - 100) {
    const summaryText = formatWeeklySummary(weeklySummary);
    sections.push(summaryText);
    totalChars += summaryText.length;
  }

  const text = sections.join('\n\n');

  return {
    text,
    tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
    metadata: {
      runsIncluded: runsText.count,
      fatigueScore,
      currentPhase,
      hasActivePlan: !!plan,
    },
  };
}

/**
 * Calculate composite fatigue score (1-10)
 * Higher = more fatigued
 */
export function calculateFatigueScore(
  feedback: RunFeedback[],
  weeklySummary: WeeklySummary | null
): number | null {
  // Returns NULL, not 5, when there is nothing to compute from.
  //
  // This used to return "5 — default middle value", which rendered as
  // "Fatigue Score: 5.0/10" and was cited by the coach as evidence of
  // under-recovery. There has been no run feedback since 2026-06-24, so every
  // request produced that number. It means "no data", and a placeholder that
  // reads as a measurement is the same failure class as the corrupt zone data.
  if (feedback.length === 0 && !weeklySummary) {
    return null;
  }

  let score = 0;
  let factors = 0;

  // Factor 1: Average effort level from recent runs (higher effort = more fatigue)
  if (feedback.length > 0) {
    const avgEffort = feedback.reduce((sum, f) => sum + (f.effort_level || 5), 0) / feedback.length;
    score += avgEffort;
    factors++;
  }

  // Factor 2: Sleep quality (lower sleep = more fatigue)
  if (weeklySummary?.sleep_quality) {
    const sleepFatigue = 11 - weeklySummary.sleep_quality; // Invert: low sleep = high fatigue
    score += sleepFatigue;
    factors++;
  }

  // Factor 3: Stress level (higher stress = more fatigue)
  if (weeklySummary?.stress_level) {
    score += weeklySummary.stress_level;
    factors++;
  }

  // Factor 4: Overall feeling (lower feeling = more fatigue)
  if (weeklySummary?.overall_feeling) {
    const feelingFatigue = 11 - weeklySummary.overall_feeling;
    score += feelingFatigue;
    factors++;
  }

  // Average all factors
  const avgScore = factors > 0 ? score / factors : 5;

  // Clamp to 1-10
  return Math.max(1, Math.min(10, Math.round(avgScore * 10) / 10));
}

/**
 * Format athlete profile for AI
 */
function formatProfile(profile: AthleteProfile): string {
  const lines: string[] = ['## Athlete Profile'];

  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.age) lines.push(`Age: ${profile.age}`);
  if (profile.weight_kg) lines.push(`Weight: ${profile.weight_kg} kg`);
  // Render long-term aspiration + active focus separately so the coach
  // can anchor day-to-day advice on the active focus and treat the
  // long-term goal as background context (not the target this week).
  if (profile.long_term_goal) {
    lines.push(`Long-term aspiration: ${profile.long_term_goal}`);
  }
  if (profile.active_goal_focus) {
    lines.push(`Active focus (current plan): ${profile.active_goal_focus}`);
  }
  // Backwards-compat: still emit current_goal when neither split field is set
  if (!profile.long_term_goal && !profile.active_goal_focus && profile.current_goal) {
    lines.push(`Goal: ${profile.current_goal}`);
  }

  // HR zones
  if (profile.max_hr) {
    lines.push(`Max HR: ${profile.max_hr} bpm (measured — the zone bands below are anchored on it)`);
    if (profile.lactate_threshold_hr) {
      // Provenance matters here. 165 has never been lab- or field-tested. It was
      // deliberately not raised to intervals.icu's 173, which is a peak-fitness
      // estimate the athlete is nowhere near — his hardest recent session peaked
      // at 166. Rendered bare, the coach reasoned from it as a hard boundary.
      lines.push(
        `Lactate Threshold HR: ${profile.lactate_threshold_hr} bpm (ESTIMATED, never tested — treat as rough context, not a boundary. Do not build prescriptions on it or claim a run was above/below "threshold" as though it were measured.)`,
      );
    }
  }

  // Injury history
  if (profile.injury_history) {
    lines.push(`Injury History: ${profile.injury_history}`);
  }

  // Training days
  if (profile.training_days) {
    lines.push(`Available Training Days: ${profile.training_days}`);
  }

  return lines.join('\n');
}

/**
 * Format current training status summary
 */
function formatTrainingStatus(
  runs: Run[],
  fatigueScore: number | null,
  currentPhase: string | null
): string {
  const lines: string[] = ['## Current Training Status'];

  // Calculate weekly totals
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thisWeekRuns = runs.filter(r => new Date(r.date) >= weekAgo);

  const weeklyKm = thisWeekRuns.reduce((sum, r) => sum + (r.distance_km || 0), 0);
  const weeklyRuns = thisWeekRuns.length;

  lines.push(`This Week: ${weeklyRuns} runs, ${weeklyKm.toFixed(1)} km`);
  // Say the data is missing rather than printing a number that means nothing.
  lines.push(
    fatigueScore === null
      ? 'Fatigue Score: not available — no run feedback logged recently. Do not infer a fatigue level from its absence.'
      : `Fatigue Score: ${fatigueScore.toFixed(1)}/10 ${getFatigueDescription(fatigueScore)}`,
  );

  if (currentPhase) {
    lines.push(`Current Phase: ${currentPhase}`);
  }

  // Recent workout types
  const recentTypes = [...new Set(runs.slice(0, 5).map(r => r.run_type || r.workout_name).filter(Boolean))];
  if (recentTypes.length > 0) {
    lines.push(`Recent Workout Types: ${recentTypes.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Get fatigue level description
 */
function getFatigueDescription(score: number): string {
  if (score <= 3) return '(Fresh)';
  if (score <= 5) return '(Moderate)';
  if (score <= 7) return '(Tired)';
  return '(Very Fatigued)';
}

/**
 * Format recent runs for AI, with per-run feedback and laps inlined.
 * Feedback is joined to runs by run_id when available, otherwise by date match.
 */
function formatRecentRuns(
  runs: RunWithLaps[],
  feedback: FeedbackWithRun[],
  maxChars: number,
  decouplingHistory: number[] = [],
  plan: TrainingPlan | null = null,
): { text: string; count: number } {
  if (runs.length === 0) {
    return { text: '## Recent Runs\nNo recent runs recorded.', count: 0 };
  }

  const byRunId = new Map<string, FeedbackWithRun>();
  const byDate = new Map<string, FeedbackWithRun>();
  for (const f of feedback || []) {
    if (f.run_id) byRunId.set(f.run_id, f);
    if (f.run_date) byDate.set(f.run_date, f);
  }

  const lines: string[] = ['## Recent Runs (Last 14 Days)'];
  let charCount = lines[0].length;
  let count = 0;

  for (const run of runs) {
    const fb = byRunId.get(run.id) || byDate.get((run.date || '').slice(0, 10));
    const runBlock = formatRunBlock(run, fb, decouplingHistory, plan);

    // Check if adding this run would exceed limit
    if (charCount + runBlock.length > maxChars && count > 0) {
      break;
    }

    lines.push(runBlock);
    charCount += runBlock.length;
    count++;
  }

  if (count < runs.length) {
    lines.push(`... and ${runs.length - count} more runs`);
  }

  return { text: lines.join('\n'), count };
}

/**
 * One run, possibly multi-line: summary + lap detail + my feedback.
 */
function formatRunBlock(
  run: RunWithLaps,
  fb: FeedbackWithRun | undefined,
  decouplingHistory: number[] = [],
  plan: TrainingPlan | null = null,
): string {
  const lines: string[] = [formatSingleRun(run, decouplingHistory)];

  // Intent vs actual. Intent comes from the PLAN — never from run_type, which
  // classifyRun derives from these same zones.
  const { workout } = plannedWorkoutForRunDate(plan, run.date);
  lines.push(
    '  ' +
      formatZoneDiscipline({
        targetHr: workout?.target_hr ?? null,
        plannedType: workout?.type ?? null,
        zones: run,
      }),
  );

  const lapText = formatRunLaps(run.laps);
  if (lapText) lines.push(lapText);

  const fbText = formatRunFeedback(fb);
  if (fbText) lines.push(fbText);

  return lines.join('\n');
}

/**
 * Format a single run summary line
 */
function formatSingleRun(run: Run, decouplingHistory: number[] = []): string {
  const date = new Date(run.date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const parts: string[] = [
    `- ${date}:`,
    run.workout_name || run.run_type || 'Run',
    `${run.distance_km?.toFixed(1) || '?'} km`,
  ];

  if (run.duration_min) {
    parts.push(`${run.duration_min.toFixed(0)} min`);
  }

  if (run.avg_pace_str) {
    parts.push(`@ ${run.avg_pace_str}/km`);
    const gap = formatGapAgainst(run.avg_pace_min_km, run.gap_pace_min_km);
    if (gap) parts.push(gap);
  }

  if (run.avg_hr) {
    parts.push(`HR: ${run.avg_hr}`);
  }

  if (run.cadence_spm) {
    parts.push(`${run.cadence_spm}spm`);
  }

  if (typeof run.decoupling_pct === 'number') {
    parts.push(formatDecoupling(run.decoupling_pct, decouplingHistory));
  }

  // Add zone distribution if significant hard effort
  if (run.pct_z4 && run.pct_z4 > 10) {
    parts.push(`(${run.pct_z4.toFixed(0)}% Z4+)`);
  }

  return parts.join(' ');
}

/**
 * Grade-adjusted pace, rendered only when it materially disagrees with raw pace.
 *
 * On flat ground GAP and raw pace differ by 2-3 s/km, which is noise — printing
 * it on every run would cost tokens and train the reader to skip it. On net
 * descending terrain the gap reaches 36-48 s/km, and that is precisely where
 * raw pace misleads: a 6:17/km "threshold" session whose true equivalent effort
 * is 7:04/km is an easy run wearing a hard run's numbers.
 *
 * The sign is stated explicitly rather than left to inference, because "GAP is
 * slower than raw" is the counter-intuitive direction and the one that matters.
 *
 * ## Absence is rendered, not implied
 *
 * intervals.icu history starts 2025-08-05, so 564 of 681 runs will never have a
 * GAP value. Without an explicit marker, a blank would mean either "this run was
 * flat" or "we have no idea" — different facts the coach cannot tell apart, and
 * the ambiguity bites in weekly review and any long-horizon comparison. `GAP
 * n/a` costs a few tokens and makes absence mean absence.
 */
/**
 * Aerobic decoupling, placed against the athlete's own distribution.
 *
 * Friel's <5 / 5-8 / >8 bands are defined on RAW Pa:HR and calibrated on other
 * athletes. This figure is grade-adjusted, and applied unchanged those bands
 * would label a third of this athlete's easy and long running as "went too
 * hard" (his median is 6.9%). That might be true — rebuilding at CTL 17.7
 * through an Israeli August, thermal drift on easy runs raises Pa:HR exactly
 * this way — or the threshold may simply not be his. There is not yet enough
 * history to tell.
 *
 * So the percentile leads, since it is the part that is certainly true, and the
 * convention follows as context rather than verdict.
 */
export function formatDecoupling(pct: number, history: number[]): string {
  const percentile = percentileOf(pct, history);
  const median = medianOf(history);

  const own =
    percentile !== null && median !== null
      ? `p${percentile} of your own history, median ${median}%`
      : 'not enough history to place it yet';

  return `[decoupling ${pct}% grade-adj — ${own}]`;
}

const GAP_NOISE_FLOOR_SEC = 8;

export function formatGapAgainst(
  rawPaceMinKm: number | null | undefined,
  gapPaceMinKm: number | null | undefined,
): string {
  // No stored value: say so, rather than looking identical to a flat run.
  if (typeof gapPaceMinKm !== 'number') return '[GAP n/a]';
  if (typeof rawPaceMinKm !== 'number') return '';

  const deltaSec = (gapPaceMinKm - rawPaceMinKm) * 60;
  if (Math.abs(deltaSec) < GAP_NOISE_FLOOR_SEC) return '';

  const harder = deltaSec > 0 ? 'downhill-aided' : 'uphill-penalised';
  return `[GAP ${formatPace(gapPaceMinKm)}/km, ${deltaSec > 0 ? '+' : ''}${Math.round(deltaSec)}s — ${harder}]`;
}

/**
 * Compact per-lap summary so the AI can reason about intervals
 * (Norwegian-style "did pace hold across reps", HR drift, etc.).
 * Returns empty string when there are no meaningful laps.
 */
export function formatRunLaps(laps: Lap[] | undefined): string {
  if (!laps || laps.length < 2) return '';

  // Skip noise: very short laps from auto-laps (<200m) are usually transitions
  const meaningful = laps.filter(l => (l.distance_km ?? 0) >= 0.2);
  if (meaningful.length < 2) return '';

  // Cap how many lap lines to emit to stay token-cheap
  const MAX_LAPS = 16;
  const slice = meaningful.slice(0, MAX_LAPS);
  const firstHr = slice[0]?.avg_hr ?? null;

  const lapLines = slice.map(l => {
    const dist = l.distance_km?.toFixed(2) ?? '?';
    const dur = l.duration_sec != null ? formatSeconds(l.duration_sec) : '?';
    const pace = l.avg_pace_str ? `${l.avg_pace_str}/km` : '';
    // Per-rep GAP is where grade adjustment matters most — it separates "that
    // rep was genuinely faster" from "that rep was downhill".
    const gap = l.gap_pace_min_km != null && l.duration_sec && l.distance_km
      ? formatGapAgainst(l.duration_sec / 60 / l.distance_km, l.gap_pace_min_km)
      : '';
    const hr = l.avg_hr ? `HR ${l.avg_hr}` : '';
    const cad = l.cadence_spm ? ` ${l.cadence_spm}spm` : '';
    const drift = firstHr && l.avg_hr ? ` (${formatDrift(l.avg_hr - firstHr)})` : '';
    return `    L${l.lap_number}: ${dist}km / ${dur} ${pace} ${gap} ${hr}${cad}${drift}`.trim().replace(/ +/g, ' ');
  });

  const trailing = meaningful.length > MAX_LAPS ? `\n    … +${meaningful.length - MAX_LAPS} more laps` : '';

  // Absence stated once on the header rather than on every lap line. Without
  // it, a lap with no GAP is indistinguishable from a flat one — and 220 laps
  // sit on runs whose splits could not be aligned to intervals.icu intervals.
  const anyGap = slice.some((l) => l.gap_pace_min_km != null);
  const header = anyGap ? '  Laps:' : '  Laps (GAP n/a for this run):';
  return `${header}\n${lapLines.join('\n')}${trailing}`;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDrift(delta: number): string {
  if (Math.abs(delta) < 1) return '±0';
  return delta > 0 ? `+${Math.round(delta)}bpm vs L1` : `${Math.round(delta)}bpm vs L1`;
}

/**
 * Show the athlete's own write-up of the run: rating, effort, feeling, comment.
 * This is the missing piece that made the coach feel "unaware" of logged runs.
 */
function formatRunFeedback(fb: FeedbackWithRun | undefined): string {
  if (!fb) return '';
  const bits: string[] = [];
  if (fb.rating != null) bits.push(`rated ${fb.rating}/10`);
  if (fb.effort_level != null) bits.push(`effort ${fb.effort_level}/10`);
  if (fb.feeling) bits.push(`felt "${fb.feeling}"`);
  const fbAny = fb as RunFeedback & { followed_plan?: boolean | null; pre_run_feeling?: string | null };
  if (fbAny.followed_plan === false) bits.push('deviated from plan');
  if (fbAny.pre_run_feeling) bits.push(`pre-run: "${fbAny.pre_run_feeling}"`);
  const head = bits.length ? `  Feedback: ${bits.join(', ')}` : '';
  const note = fb.comment ? `\n  Note: "${fb.comment}"` : '';
  if (!head && !note) return '';
  return `${head}${note}`.trim();
}

/**
 * Format active training plan summary, INCLUDING the current week's per-day workouts.
 * Before this fix the AI saw only phase / focus / total_km, so weekly review couldn't
 * compare planned vs actual at the workout level.
 */
function formatActivePlan(plan: TrainingPlan, liveWeek: number): string {
  const lines: string[] = ['## Active Training Plan'];

  lines.push(`Plan: ${plan.plan_type}`);
  lines.push(`Duration: ${plan.duration_weeks} weeks`);
  lines.push(`Current Week: ${liveWeek} of ${plan.duration_weeks}`);

  if (plan.plan_json?.methodology) {
    lines.push(`Methodology: ${plan.plan_json.methodology}`);
  }

  const currentWeek = plan.plan_json?.weeks?.[liveWeek - 1];
  if (currentWeek) {
    lines.push(`Phase: ${currentWeek.phase}`);
    lines.push(`Focus: ${currentWeek.focus}`);
    lines.push(`Target Volume: ${currentWeek.total_km} km`);

    if (currentWeek.workouts && Object.keys(currentWeek.workouts).length > 0) {
      lines.push('Planned workouts this week:');
      const sorted = sortWorkoutsByDay(currentWeek.workouts as Record<string, Workout>);
      for (const [day, w] of sorted) {
        lines.push(`  ${day}: ${formatPlannedWorkout(w)}`);
      }
    }
  }

  return lines.join('\n');
}

function formatPlannedWorkout(w: Workout): string {
  const bits: string[] = [];
  bits.push(w.type || 'Run');
  if (w.distance) bits.push(w.distance);
  if (w.duration) bits.push(w.duration);
  if (w.target_pace) bits.push(`@ ${w.target_pace}`);
  if (w.target_hr) bits.push(`HR ${w.target_hr}`);
  const head = bits.join(' / ');
  const desc = w.description ? ` — ${w.description}` : '';
  return `${head}${desc}`;
}

/**
 * Public helper for the weekly review prompt: render a specific week's
 * planned workouts as a PLANNED block so the AI can place ACTUAL next to it.
 */
export function formatPlannedWeek(plan: TrainingPlan | null, weekNumber: number): string {
  if (!plan?.plan_json?.weeks) return '';
  const week = plan.plan_json.weeks[weekNumber - 1];
  if (!week) return '';
  const lines: string[] = [
    `Week ${week.week_number} | Phase: ${week.phase} | Focus: ${week.focus} | Target: ${week.total_km} km`,
  ];
  if (week.workouts) {
    const sorted = sortWorkoutsByDay(week.workouts as Record<string, Workout>);
    for (const [day, w] of sorted) {
      lines.push(`  ${day}: ${formatPlannedWorkout(w)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Format weekly summary
 */
/**
 * Recovery block for the coach prompt.
 *
 * The jargon is translated rather than passed through: the model sees Fitness /
 * Fatigue / Form, not ctl / atl / ctl-atl. Those abbreviations are ambiguous
 * outside cycling-adjacent training software, and an LLM guessing at them is a
 * confabulation risk on data the athlete will act on.
 *
 * HRV is always stated relative to baseline, never as a bare number — 48ms is
 * meaningless without knowing the athlete's normal.
 *
 * Missing readings are reported as missing. Silence would let the model infer
 * whatever suits its sentence.
 */
function formatRecovery(days: DailyWellness[], baselines: WellnessBaselines): string {
  if (days.length === 0) return '';

  const lines: string[] = ['## Recovery (last 7 days)'];

  // The newest ROW is not the newest READING. The nightly sync writes today's
  // row just after local midnight with only ctl/atl in it, so taking days[0]
  // let the coach announce "HRV today: no reading" every morning while
  // yesterday's 67 sat one row down. Watch-sourced fields read from the latest
  // row that has any; ctl/atl keep reading the newest row, where they are real.
  const latest = days.find((d) => d.hrv != null || d.resting_hr != null || d.sleep_secs != null) ?? days[0];
  const loadRow = days[0];

  // Every reading below is labelled with its date and age, so a day-old HRV can
  // never be presented as this morning's.
  const readingAge = daysBetweenDateStr(latest.day, userDateStr());
  const asOf =
    readingAge <= 0 ? 'today'
    : readingAge === 1 ? 'yesterday'
    : `${readingAge} days ago`;
  const stamp = `${latest.day}, ${asOf}`;
  if (readingAge > 0) {
    lines.push(
      `- READINGS ARE FROM ${stamp}. Today's have not synced from the watch yet — ` +
        `describe them as ${asOf}'s, not as this morning's.`,
    );
  }

  const hrvVals = days.map((d) => d.hrv).filter((v): v is number => typeof v === 'number');
  if (typeof latest.hrv === 'number' && baselines.hrvMean !== null && baselines.hrvSd) {
    const sdBelow = (baselines.hrvMean - latest.hrv) / baselines.hrvSd;
    const descriptor =
      sdBelow > 1 ? 'suppressed — body still absorbing load'
      : sdBelow > 0.5 ? 'slightly below normal'
      : sdBelow < -1 ? 'well above normal — well recovered'
      : 'within normal range';
    lines.push(
      `- HRV (${asOf}): ${latest.hrv.toFixed(0)}ms vs ${baselines.hrvMean.toFixed(0)}ms baseline ` +
        `(${baselines.windowDays}-day mean) — ${sdBelow >= 0 ? '' : '+'}${(-sdBelow).toFixed(1)} SD, ${descriptor}.`,
    );
  } else if (typeof latest.hrv === 'number') {
    lines.push(`- HRV (${asOf}): ${latest.hrv.toFixed(0)}ms (not enough history yet for a baseline — do not call this high or low).`);
  } else {
    lines.push('- HRV: no reading in the last 7 days (watch not worn overnight). Do not treat this as poor recovery.');
  }

  if (hrvVals.length > 1) {
    const trend = hrvVals.slice(0, 7).reverse().map((v) => v.toFixed(0)).join(' → ');
    lines.push(`- HRV trend (oldest to newest): ${trend}`);
  }

  if (typeof latest.sleep_secs === 'number') {
    const hours = latest.sleep_secs / 3600;
    const score = typeof latest.sleep_score === 'number' ? `, sleep score ${latest.sleep_score}/100` : '';
    lines.push(`- Sleep (night of ${latest.day}, ${asOf}): ${hours.toFixed(1)}h${score}.`);
  } else {
    lines.push('- Sleep: no data in the last 7 days.');
  }

  if (typeof latest.resting_hr === 'number') {
    const vs =
      baselines.restingHrMean !== null
        ? ` vs ${baselines.restingHrMean.toFixed(0)} baseline (${latest.resting_hr - baselines.restingHrMean >= 0 ? '+' : ''}${(latest.resting_hr - baselines.restingHrMean).toFixed(0)} bpm)`
        : '';
    lines.push(`- Resting HR (${asOf}): ${latest.resting_hr}${vs}.`);
  }

  // Fitness / Fatigue / Form, named in plain language.
  if (typeof loadRow.ctl === 'number' && typeof loadRow.atl === 'number') {
    const form = loadRow.ctl - loadRow.atl;
    const formNote =
      form > 5 ? 'fresh, possibly detrained'
      : form >= -10 ? 'normal training range'
      : 'carrying real fatigue';
    lines.push(
      `- Fitness ${loadRow.ctl.toFixed(1)} · Fatigue ${loadRow.atl.toFixed(1)} · Form ${form >= 0 ? '+' : ''}${form.toFixed(1)} (${formNote}).`,
    );
    lines.push('  Fitness is chronic training load, Fatigue is acute load, Form is Fitness minus Fatigue.');
  }

  if (typeof latest.weight_kg === 'number') lines.push(`- Weight: ${latest.weight_kg.toFixed(1)}kg.`);

  const missing = 7 - days.length;
  if (missing > 0) lines.push(`- Note: only ${days.length} of the last 7 days have recovery data.`);

  return lines.join('\n');
}

function formatWeeklySummary(summary: WeeklySummary): string {
  const lines: string[] = ['## This Week Summary'];

  if (summary.overall_feeling) {
    lines.push(`Overall Feeling: ${summary.overall_feeling}/10`);
  }
  if (summary.sleep_quality) {
    lines.push(`Sleep Quality: ${summary.sleep_quality}/10`);
  }
  if (summary.stress_level) {
    lines.push(`Stress Level: ${summary.stress_level}/10`);
  }
  if (summary.injury_notes) {
    lines.push(`Injuries/Issues: ${summary.injury_notes}`);
  }
  if (summary.achievements) {
    lines.push(`Achievements: ${summary.achievements}`);
  }

  return lines.join('\n');
}

/**
 * Get the latest weekly summary for a user
 */
async function getLatestWeeklySummary(userId: string): Promise<WeeklySummary | null> {
  // Start of the current week, evaluated in the user's timezone — the
  // summary is keyed by week_start date and a UTC-evaluated Sunday could
  // point at last week between 00:00-03:00 IL Sunday.
  const now = nowInUserTz();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const dateStr = weekStart.toISOString().split('T')[0];

  return getWeeklySummary(userId, dateStr);
}

/**
 * Every decoupling value this athlete has, for percentile placement.
 *
 * Whole history rather than a trailing window: the point of comparison is "is
 * this normal for me", and with ~76 values a shorter window would leave the
 * percentile too coarse to mean anything.
 */
async function getDecouplingHistory(userId: string): Promise<number[]> {
  const { data } = await supabase
    .from('runs')
    .select('decoupling_pct')
    .eq('user_id', userId)
    .not('decoupling_pct', 'is', null);

  return ((data ?? []) as { decoupling_pct: number }[]).map((r) => r.decoupling_pct);
}
