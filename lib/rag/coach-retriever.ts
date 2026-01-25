import {
  getCoachWorkouts,
  getCoachWorkoutsByCategory,
  getCoachWorkoutsByPhase,
  searchCoachWorkouts,
} from '@/lib/db/coach-workouts';
import { supabase } from '@/lib/db/supabase';
import type { CoachWorkout, CoachPhase } from '@/lib/db/types';
import type { FormattedCoachContext } from './types';

// Approximate tokens per character
const CHARS_PER_TOKEN = 4;

/**
 * Retrieve and format old coach context for AI consumption
 * Includes workout library, phases, and historical patterns
 */
export async function retrieveCoachContext(
  userId: string,
  query: string,
  filters: {
    phase?: string;
    workoutType?: string;
    category?: string;
  },
  maxTokens: number
): Promise<FormattedCoachContext> {
  // Fetch relevant coach data based on filters
  const [workouts, phases] = await Promise.all([
    fetchRelevantWorkouts(userId, filters, query),
    fetchRelevantPhases(userId, filters.phase),
  ]);

  // Format for AI
  const sections: string[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // 1. Relevant workouts from old coach
  if (workouts.length > 0) {
    const workoutsText = formatWorkouts(workouts, maxChars - 200); // Reserve space for phases
    sections.push(workoutsText.text);
    totalChars += workoutsText.text.length;
  }

  // 2. Phase information if available
  if (phases.length > 0 && totalChars < maxChars - 100) {
    const phasesText = formatPhases(phases, maxChars - totalChars);
    sections.push(phasesText.text);
    totalChars += phasesText.text.length;
  }

  const text = sections.length > 0
    ? sections.join('\n\n')
    : '## Previous Coach Data\nNo previous coach workout data available.';

  return {
    text,
    tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
    workoutsIncluded: workouts.map(w => w.workout_name),
    phasesIncluded: phases.map(p => p.phase_name),
  };
}

/**
 * Fetch relevant workouts based on filters and query
 */
async function fetchRelevantWorkouts(
  userId: string,
  filters: {
    phase?: string;
    workoutType?: string;
    category?: string;
  },
  query: string
): Promise<CoachWorkout[]> {
  let workouts: CoachWorkout[] = [];

  // 1. Try phase-specific workouts first
  if (filters.phase) {
    workouts = await getCoachWorkoutsByPhase(userId, filters.phase);
    if (workouts.length > 0) {
      return workouts.slice(0, 5); // Limit to top 5
    }
  }

  // 2. Try category-specific workouts
  if (filters.category) {
    workouts = await getCoachWorkoutsByCategory(userId, filters.category);
    if (workouts.length > 0) {
      return workouts.slice(0, 5);
    }
  }

  // 3. Try searching by query keywords
  const keywords = extractKeywords(query);
  for (const keyword of keywords) {
    const results = await searchCoachWorkouts(userId, keyword);
    if (results.length > 0) {
      workouts = [...workouts, ...results];
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  workouts = workouts.filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });

  // 4. Fallback to most used workouts
  if (workouts.length === 0) {
    workouts = await getCoachWorkouts(userId);
  }

  return workouts.slice(0, 5);
}

/**
 * Fetch relevant phases
 */
async function fetchRelevantPhases(
  userId: string,
  currentPhase?: string
): Promise<CoachPhase[]> {
  const { data, error } = await supabase
    .from('coach_phases')
    .select('*')
    .eq('user_id', userId)
    .order('phase_order', { ascending: true });

  if (error || !data) {
    return [];
  }

  // If current phase specified, prioritize it
  if (currentPhase) {
    const current = data.find(p =>
      p.phase_name.toLowerCase().includes(currentPhase.toLowerCase())
    );
    if (current) {
      return [current, ...data.filter(p => p.id !== current.id).slice(0, 2)];
    }
  }

  return data.slice(0, 3);
}

/**
 * Extract keywords from query for searching
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'what', 'should', 'i', 'do', 'today', 'how', 'can', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'my', 'your', 'we', 'they', 'this', 'that', 'these', 'those',
  ]);

  const workoutKeywords = [
    'easy', 'tempo', 'interval', 'long', 'recovery', 'threshold',
    'fartlek', 'speed', 'hill', 'track', 'race', 'warmup', 'cooldown',
  ];

  const words = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Prioritize workout-related keywords
  const prioritized = words.filter(w =>
    workoutKeywords.some(k => w.includes(k) || k.includes(w))
  );

  return [...prioritized, ...words.filter(w => !prioritized.includes(w))].slice(0, 3);
}

/**
 * Format workouts for AI consumption
 */
function formatWorkouts(
  workouts: CoachWorkout[],
  maxChars: number
): { text: string; count: number } {
  const lines: string[] = ['## Previous Coach Workouts'];
  let charCount = lines[0].length;
  let count = 0;

  for (const workout of workouts) {
    const workoutText = formatSingleWorkout(workout);

    if (charCount + workoutText.length > maxChars && count > 0) {
      break;
    }

    lines.push(workoutText);
    charCount += workoutText.length;
    count++;
  }

  return { text: lines.join('\n\n'), count };
}

/**
 * Format a single workout entry
 */
function formatSingleWorkout(workout: CoachWorkout): string {
  const parts: string[] = [`### ${workout.workout_name}`];

  if (workout.category) {
    parts.push(`Category: ${workout.category}`);
  }

  if (workout.description) {
    parts.push(`Description: ${workout.description}`);
  }

  // Typical parameters
  const params: string[] = [];
  if (workout.typical_distance_km) {
    params.push(`${workout.typical_distance_km} km`);
  }
  if (workout.typical_duration_min) {
    params.push(`${workout.typical_duration_min} min`);
  }
  if (workout.target_zone) {
    params.push(`Zone: ${workout.target_zone}`);
  }
  if (workout.target_pace) {
    params.push(`Pace: ${workout.target_pace}`);
  }
  if (params.length > 0) {
    parts.push(`Typical: ${params.join(', ')}`);
  }

  // Coach wisdom
  if (workout.coach_notes) {
    parts.push(`Coach Notes: ${workout.coach_notes}`);
  }
  if (workout.when_to_use) {
    parts.push(`When to Use: ${workout.when_to_use}`);
  }
  if (workout.when_to_avoid) {
    parts.push(`When to Avoid: ${workout.when_to_avoid}`);
  }
  if (workout.recovery_needed) {
    parts.push(`Recovery Needed: ${workout.recovery_needed}`);
  }

  // Usage stats
  if (workout.times_performed && workout.times_performed > 0) {
    parts.push(`Times Performed: ${workout.times_performed}${workout.avg_feeling ? ` (Avg Feeling: ${workout.avg_feeling.toFixed(1)}/10)` : ''}`);
  }

  return parts.join('\n');
}

/**
 * Format phases for AI consumption
 */
function formatPhases(
  phases: CoachPhase[],
  maxChars: number
): { text: string; count: number } {
  const lines: string[] = ['## Previous Coach Training Phases'];
  let charCount = lines[0].length;
  let count = 0;

  for (const phase of phases) {
    const phaseText = formatSinglePhase(phase);

    if (charCount + phaseText.length > maxChars && count > 0) {
      break;
    }

    lines.push(phaseText);
    charCount += phaseText.length;
    count++;
  }

  return { text: lines.join('\n\n'), count };
}

/**
 * Format a single phase entry
 */
function formatSinglePhase(phase: CoachPhase): string {
  const parts: string[] = [`### ${phase.phase_name}`];

  if (phase.description) {
    parts.push(`Description: ${phase.description}`);
  }

  if (phase.typical_duration_weeks) {
    parts.push(`Duration: ${phase.typical_duration_weeks} weeks`);
  }

  if (phase.focus_areas && phase.focus_areas.length > 0) {
    parts.push(`Focus: ${phase.focus_areas.join(', ')}`);
  }

  if (phase.key_workouts && phase.key_workouts.length > 0) {
    parts.push(`Key Workouts: ${phase.key_workouts.join(', ')}`);
  }

  if (phase.coach_notes) {
    parts.push(`Coach Notes: ${phase.coach_notes}`);
  }

  if (phase.volume_progression) {
    parts.push(`Volume: ${phase.volume_progression}`);
  }

  return parts.join('\n');
}

/**
 * Find relevant workouts for a specific workout type
 * Useful for matching planned workouts to old coach definitions
 */
export async function findWorkoutByType(
  userId: string,
  workoutType: string
): Promise<CoachWorkout | null> {
  // Try exact match first
  const results = await searchCoachWorkouts(userId, workoutType);

  if (results.length > 0) {
    return results[0];
  }

  // Try category match
  const categoryMap: Record<string, string> = {
    'easy': 'Easy',
    'recovery': 'Easy',
    'tempo': 'Tempo',
    'threshold': 'Tempo',
    'interval': 'Intervals',
    'speed': 'Intervals',
    'long': 'Long Run',
    'endurance': 'Long Run',
  };

  const category = categoryMap[workoutType.toLowerCase()];
  if (category) {
    const categoryResults = await getCoachWorkoutsByCategory(userId, category);
    if (categoryResults.length > 0) {
      return categoryResults[0];
    }
  }

  return null;
}

/**
 * Analyze workout patterns from historical runs
 * Returns common sequences and recovery patterns
 */
export async function analyzeWorkoutPatterns(
  userId: string,
  workoutName: string
): Promise<{
  avgDuration: number;
  avgDistance: number;
  avgFeeling: number;
  typicalDayOfWeek: string;
  followedBy: string[];
} | null> {
  // Get runs with this workout name
  const { data: runs, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .ilike('workout_name', `%${workoutName}%`)
    .order('date', { ascending: true });

  if (error || !runs || runs.length === 0) {
    return null;
  }

  // Calculate averages
  const avgDuration = runs.reduce((sum, r) => sum + (r.duration_min || 0), 0) / runs.length;
  const avgDistance = runs.reduce((sum, r) => sum + (r.distance_km || 0), 0) / runs.length;

  // Get feedback for these runs to calculate average feeling
  const runDates = runs.map(r => r.date.split('T')[0]);
  const { data: feedback } = await supabase
    .from('run_feedback')
    .select('rating')
    .eq('user_id', userId)
    .in('run_date', runDates);

  const avgFeeling = feedback && feedback.length > 0
    ? feedback.reduce((sum, f) => sum + (f.rating || 5), 0) / feedback.length
    : 5;

  // Find typical day of week
  const dayCount: Record<number, number> = {};
  for (const run of runs) {
    const day = new Date(run.date).getDay();
    dayCount[day] = (dayCount[day] || 0) + 1;
  }
  const maxDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const typicalDayOfWeek = maxDay ? dayNames[parseInt(maxDay[0])] : 'Unknown';

  // Find what workouts typically follow this one
  const followedBy: string[] = [];
  for (let i = 0; i < runs.length - 1; i++) {
    const nextRun = runs[i + 1];
    if (nextRun?.workout_name) {
      followedBy.push(nextRun.workout_name);
    }
  }

  // Get unique, sorted by frequency
  const followedByCount = followedBy.reduce((acc, name) => {
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topFollowedBy = Object.entries(followedByCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  return {
    avgDuration: Math.round(avgDuration),
    avgDistance: Math.round(avgDistance * 10) / 10,
    avgFeeling: Math.round(avgFeeling * 10) / 10,
    typicalDayOfWeek,
    followedBy: topFollowedBy,
  };
}
