import { getRecentRunsWithLaps } from '@/lib/db/runs';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { getRecentFeedback, getWeeklySummary } from '@/lib/db/feedback';
import { calculateCurrentWeek, sortWorkoutsByDay } from '@/lib/utils/week-calculator';
import type { Run, Lap, RunFeedback, WeeklySummary, AthleteProfile, TrainingPlan, Workout } from '@/lib/db/types';
import type { FormattedUserContext } from './types';

type RunWithLaps = Run & { laps?: Lap[] };
type FeedbackWithRun = RunFeedback & { run_id?: string | null };

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

/**
 * Format user context for AI consumption
 * Includes recent runs, feedback, profile, and active plan
 */
export async function formatUserContext(
  userId: string,
  maxTokens: number
): Promise<FormattedUserContext> {
  // Fetch all user data in parallel
  const [runsWithLaps, feedback, profile, plan, weeklySummary] = await Promise.all([
    getRecentRunsWithLaps(userId, 14), // Last 14 days, laps attached for quality workouts
    getRecentFeedback(userId, 14),
    getAthleteProfile(userId),
    getActivePlan(userId),
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

  // 3. Recent runs (fit as many as possible) — feedback joined inline by run_id or date
  const runsText = formatRecentRuns(
    runsWithLaps,
    feedback as FeedbackWithRun[],
    maxChars - totalChars - 800, // Reserve ~800 chars for plan
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
): number {
  if (feedback.length === 0 && !weeklySummary) {
    return 5; // Default middle value
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
  if (profile.current_goal) lines.push(`Goal: ${profile.current_goal}`);

  // HR zones
  if (profile.max_hr) {
    lines.push(`Max HR: ${profile.max_hr} bpm`);
    if (profile.lactate_threshold_hr) {
      lines.push(`Lactate Threshold HR: ${profile.lactate_threshold_hr} bpm`);
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
  fatigueScore: number,
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
  lines.push(`Fatigue Score: ${fatigueScore.toFixed(1)}/10 ${getFatigueDescription(fatigueScore)}`);

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
    const runBlock = formatRunBlock(run, fb);

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
function formatRunBlock(run: RunWithLaps, fb: FeedbackWithRun | undefined): string {
  const lines: string[] = [formatSingleRun(run)];

  const lapText = formatRunLaps(run.laps);
  if (lapText) lines.push(lapText);

  const fbText = formatRunFeedback(fb);
  if (fbText) lines.push(fbText);

  return lines.join('\n');
}

/**
 * Format a single run summary line
 */
function formatSingleRun(run: Run): string {
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
  }

  if (run.avg_hr) {
    parts.push(`HR: ${run.avg_hr}`);
  }

  // Add zone distribution if significant hard effort
  if (run.pct_z4 && run.pct_z4 > 10) {
    parts.push(`(${run.pct_z4.toFixed(0)}% Z4+)`);
  }

  return parts.join(' ');
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
    const hr = l.avg_hr ? `HR ${l.avg_hr}` : '';
    const drift = firstHr && l.avg_hr ? ` (${formatDrift(l.avg_hr - firstHr)})` : '';
    return `    L${l.lap_number}: ${dist}km / ${dur} ${pace} ${hr}${drift}`.trim().replace(/ +/g, ' ');
  });

  const trailing = meaningful.length > MAX_LAPS ? `\n    … +${meaningful.length - MAX_LAPS} more laps` : '';
  return `  Laps:\n${lapLines.join('\n')}${trailing}`;
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
  // Get the start of the current week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const dateStr = weekStart.toISOString().split('T')[0];

  return getWeeklySummary(userId, dateStr);
}
