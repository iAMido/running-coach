/**
 * Morning-after coach note.
 *
 * When the Strava sync imports a run, generate a two-sentence reaction in
 * the coach's voice and store it in runs.coach_notes. The dashboard hero
 * surfaces it, turning the app from "tool I query" into "coach who
 * watches me" — the run gets acknowledged without the athlete asking.
 *
 * Deliberately cheap: Haiku, tiny prompt, no RAG. Failure is always
 * non-fatal — a run without a note is just the old behaviour.
 */

import { callOpenRouter } from '@/lib/ai/openrouter';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { dateInUserTz } from '@/lib/utils/user-time';
import type { TrainingPlan, Workout } from '@/lib/db/types';

/**
 * What did the plan call for on the day this run happened?
 * Evaluates the run's date in the user's timezone, resolves the plan week
 * containing it, and picks that day's workout. Returns null when the plan
 * doesn't cover the date.
 */
export function plannedWorkoutForRunDate(
  plan: TrainingPlan | null | undefined,
  runDate: string | Date,
): { workout: Workout | null; phase: string | null } {
  if (!plan?.plan_json?.weeks || !plan.start_date) return { workout: null, phase: null };
  const localDate = dateInUserTz(new Date(runDate));
  const info = calculateCurrentWeek(plan.start_date, plan.duration_weeks, localDate);
  if (info.isBeforeStart || info.isAfterEnd) return { workout: null, phase: null };
  const week = plan.plan_json.weeks[info.currentWeek - 1];
  if (!week) return { workout: null, phase: null };
  const dayName = localDate.toLocaleDateString('en-US', { weekday: 'long' });
  const workout = week.workouts?.[dayName] ?? null;
  return { workout, phase: week.phase ?? null };
}

const REACTION_SYSTEM_PROMPT = `You are the athlete's running coach reacting to a run that just synced from their watch. Write EXACTLY two short sentences, in the coach's voice, direct and personal:
- Sentence 1: acknowledge what they actually did (distance/pace/HR — be specific with one number).
- Sentence 2: one actionable observation — pacing discipline, HR drift, zone distribution vs what the day called for, or what tomorrow needs.

Rules:
- If the day's planned workout is provided, judge the run against it (too hard / on target / mismatched type).
- If zones show >35% in Z4+ on an easy/recovery day, call it out firmly but kindly.
- No greetings, no emoji, no hashtags, no "great job" filler. Coach, not cheerleader.
- Max 45 words total.`;

export interface RunReactionInput {
  distanceKm: number;
  durationMin: number;
  avgPaceStr?: string | null;
  avgHr?: number | null;
  runType?: string | null;
  zonePercents?: { z1?: number; z2?: number; z3?: number; z4?: number; z5?: number; z6?: number } | null;
  /** What the plan said today should be, if known. */
  plannedWorkout?: Workout | null;
  planPhase?: string | null;
}

export async function generateRunReaction(input: RunReactionInput): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const z = input.zonePercents;
  const zoneLine = z
    ? `Zones: Z1 ${Math.round(z.z1 || 0)}% / Z2 ${Math.round(z.z2 || 0)}% / Z3 ${Math.round(z.z3 || 0)}% / Z4 ${Math.round(z.z4 || 0)}% / Z5 ${Math.round(z.z5 || 0)}%`
    : 'Zones: not available';

  const planned = input.plannedWorkout
    ? `Planned today: ${input.plannedWorkout.type}${input.plannedWorkout.distance ? ` ${input.plannedWorkout.distance}` : ''}${input.plannedWorkout.target_pace ? ` @ ${input.plannedWorkout.target_pace}` : ''}${input.plannedWorkout.target_hr ? ` HR ${input.plannedWorkout.target_hr}` : ''}`
    : 'Planned today: nothing on the plan (or no active plan)';

  const userPrompt = `RUN JUST SYNCED:
- ${input.distanceKm.toFixed(1)}km in ${Math.round(input.durationMin)}min${input.avgPaceStr ? ` @ ${input.avgPaceStr}/km` : ''}${input.avgHr ? `, avg HR ${input.avgHr}` : ''}
- Classified as: ${input.runType || 'unknown'}
- ${zoneLine}
- ${planned}${input.planPhase ? `\n- Current plan phase: ${input.planPhase}` : ''}`;

  try {
    const resp = await callOpenRouter(
      [
        { role: 'system', content: REACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { apiKey, model: MODEL_FOR.chat_quick, maxTokens: 120 },
    );
    if (resp.error || !resp.content) return null;
    const text = resp.content.trim();
    // Guard against runaway output — the note lives in a small card.
    return text.length > 400 ? text.slice(0, 400) : text;
  } catch {
    return null;
  }
}
