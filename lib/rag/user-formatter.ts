import { getRecentRuns } from '@/lib/db/runs';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { getRecentFeedback, getWeeklySummary } from '@/lib/db/feedback';
import type { Run, RunFeedback, WeeklySummary, AthleteProfile, TrainingPlan } from '@/lib/db/types';
import type { FormattedUserContext } from './types';

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
  const [runs, feedback, profile, plan, weeklySummary] = await Promise.all([
    getRecentRuns(userId, 14), // Last 14 days
    getRecentFeedback(userId, 14),
    getAthleteProfile(userId),
    getActivePlan(userId),
    getLatestWeeklySummary(userId),
  ]);

  // Calculate fatigue score
  const fatigueScore = calculateFatigueScore(feedback, weeklySummary);

  // Determine current phase from plan
  const currentPhase = plan?.plan_json?.weeks?.[
    (plan.current_week_num || 1) - 1
  ]?.phase || null;

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
  const statusText = formatTrainingStatus(runs, fatigueScore, currentPhase);
  sections.push(statusText);
  totalChars += statusText.length;

  // 3. Recent runs (fit as many as possible)
  const runsText = formatRecentRuns(runs, maxChars - totalChars - 500); // Reserve 500 chars for plan
  sections.push(runsText.text);
  totalChars += runsText.text.length;

  // 4. Active plan summary
  if (plan && totalChars < maxChars - 200) {
    const planText = formatActivePlan(plan);
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
 * Format recent runs for AI
 */
function formatRecentRuns(
  runs: Run[],
  maxChars: number
): { text: string; count: number } {
  if (runs.length === 0) {
    return { text: '## Recent Runs\nNo recent runs recorded.', count: 0 };
  }

  const lines: string[] = ['## Recent Runs (Last 14 Days)'];
  let charCount = lines[0].length;
  let count = 0;

  for (const run of runs) {
    const runLine = formatSingleRun(run);

    // Check if adding this run would exceed limit
    if (charCount + runLine.length > maxChars && count > 0) {
      break;
    }

    lines.push(runLine);
    charCount += runLine.length;
    count++;
  }

  if (count < runs.length) {
    lines.push(`... and ${runs.length - count} more runs`);
  }

  return { text: lines.join('\n'), count };
}

/**
 * Format a single run entry
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
 * Format active training plan summary
 */
function formatActivePlan(plan: TrainingPlan): string {
  const lines: string[] = ['## Active Training Plan'];

  lines.push(`Plan: ${plan.plan_type}`);
  lines.push(`Duration: ${plan.duration_weeks} weeks`);
  lines.push(`Current Week: ${plan.current_week_num}`);

  if (plan.plan_json?.methodology) {
    lines.push(`Methodology: ${plan.plan_json.methodology}`);
  }

  // Current week details
  const currentWeek = plan.plan_json?.weeks?.[plan.current_week_num - 1];
  if (currentWeek) {
    lines.push(`Phase: ${currentWeek.phase}`);
    lines.push(`Focus: ${currentWeek.focus}`);
    lines.push(`Target Volume: ${currentWeek.total_km} km`);
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
