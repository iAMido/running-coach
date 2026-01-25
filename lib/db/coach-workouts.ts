import { supabase } from './supabase';
import { CoachWorkout } from './types';

// ============================================================
// Coach Workouts CRUD Operations
// For old coach data from TrainingPeaks
// ============================================================

/**
 * Get all coach workouts for a user
 */
export async function getCoachWorkouts(userId: string): Promise<CoachWorkout[]> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .order('times_performed', { ascending: false });

  if (error) {
    console.error('Error fetching coach workouts:', error);
    return [];
  }

  return data || [];
}

/**
 * Get coach workouts filtered by category
 */
export async function getCoachWorkoutsByCategory(
  userId: string,
  category: string
): Promise<CoachWorkout[]> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('category', category)
    .order('times_performed', { ascending: false });

  if (error) {
    console.error('Error fetching coach workouts by category:', error);
    return [];
  }

  return data || [];
}

/**
 * Get coach workouts filtered by training phase
 */
export async function getCoachWorkoutsByPhase(
  userId: string,
  phase: string
): Promise<CoachWorkout[]> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('training_phase', phase)
    .order('times_performed', { ascending: false });

  if (error) {
    console.error('Error fetching coach workouts by phase:', error);
    return [];
  }

  return data || [];
}

/**
 * Search coach workouts by name (fuzzy match)
 */
export async function searchCoachWorkouts(
  userId: string,
  searchTerm: string
): Promise<CoachWorkout[]> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .ilike('workout_name', `%${searchTerm}%`)
    .order('times_performed', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error searching coach workouts:', error);
    return [];
  }

  return data || [];
}

/**
 * Get a single coach workout by ID
 */
export async function getCoachWorkout(
  userId: string,
  workoutId: string
): Promise<CoachWorkout | null> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', workoutId)
    .single();

  if (error) {
    console.error('Error fetching coach workout:', error);
    return null;
  }

  return data;
}

/**
 * Get a coach workout by name
 */
export async function getCoachWorkoutByName(
  userId: string,
  workoutName: string
): Promise<CoachWorkout | null> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('workout_name', workoutName)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Error fetching coach workout by name:', error);
    return null;
  }

  return data;
}

/**
 * Create or update a coach workout (upsert by name)
 */
export async function upsertCoachWorkout(
  userId: string,
  workout: Omit<CoachWorkout, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<CoachWorkout | null> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .upsert(
      {
        ...workout,
        user_id: userId,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,workout_name',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting coach workout:', error);
    return null;
  }

  return data;
}

/**
 * Create a new coach workout
 */
export async function createCoachWorkout(
  userId: string,
  workout: Omit<CoachWorkout, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<CoachWorkout | null> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .insert({
      ...workout,
      user_id: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating coach workout:', error);
    return null;
  }

  return data;
}

/**
 * Update an existing coach workout
 */
export async function updateCoachWorkout(
  userId: string,
  workoutId: string,
  updates: Partial<CoachWorkout>
): Promise<CoachWorkout | null> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', workoutId)
    .select()
    .single();

  if (error) {
    console.error('Error updating coach workout:', error);
    return null;
  }

  return data;
}

/**
 * Delete a coach workout
 */
export async function deleteCoachWorkout(
  userId: string,
  workoutId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('coach_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('id', workoutId);

  if (error) {
    console.error('Error deleting coach workout:', error);
    return false;
  }

  return true;
}

/**
 * Bulk insert coach workouts (for imports)
 */
export async function bulkInsertCoachWorkouts(
  userId: string,
  workouts: Omit<CoachWorkout, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]
): Promise<{ inserted: number; errors: string[] }> {
  const results = { inserted: 0, errors: [] as string[] };

  for (const workout of workouts) {
    const { error } = await supabase
      .from('coach_workouts')
      .upsert(
        {
          ...workout,
          user_id: userId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,workout_name',
        }
      );

    if (error) {
      results.errors.push(`Failed to insert "${workout.workout_name}": ${error.message}`);
    } else {
      results.inserted++;
    }
  }

  return results;
}

/**
 * Increment the times_performed counter and update last_performed date
 */
export async function recordWorkoutPerformed(
  userId: string,
  workoutName: string,
  feeling?: number
): Promise<void> {
  const existing = await getCoachWorkoutByName(userId, workoutName);

  if (existing) {
    // Calculate new average feeling if provided
    let newAvgFeeling = existing.avg_feeling;
    if (feeling !== undefined) {
      const currentAvg = existing.avg_feeling || 0;
      const currentCount = existing.times_performed || 0;
      newAvgFeeling = ((currentAvg * currentCount) + feeling) / (currentCount + 1);
    }

    await supabase
      .from('coach_workouts')
      .update({
        times_performed: (existing.times_performed || 0) + 1,
        last_performed: new Date().toISOString().split('T')[0],
        avg_feeling: newAvgFeeling,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', existing.id);
  }
}

/**
 * Get workout categories for a user (distinct values)
 */
export async function getWorkoutCategories(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('coach_workouts')
    .select('category')
    .eq('user_id', userId)
    .not('category', 'is', null);

  if (error) {
    console.error('Error fetching workout categories:', error);
    return [];
  }

  // Get unique categories
  const categories = [...new Set(data?.map(d => d.category).filter(Boolean))];
  return categories as string[];
}

/**
 * Derive coach workouts from existing runs
 * Analyzes the runs table to extract unique workout names and their patterns
 */
export async function deriveWorkoutsFromRuns(userId: string): Promise<{
  workouts: Omit<CoachWorkout, 'id' | 'user_id' | 'created_at' | 'updated_at'>[];
  analyzed: number;
}> {
  // Get all runs with workout names
  const { data: runs, error } = await supabase
    .from('runs')
    .select('workout_name, coach_notes, distance_km, duration_min, date, run_type')
    .eq('user_id', userId)
    .not('workout_name', 'is', null)
    .order('date', { ascending: false });

  if (error || !runs) {
    console.error('Error fetching runs for workout derivation:', error);
    return { workouts: [], analyzed: 0 };
  }

  // Group runs by workout name
  const workoutMap = new Map<string, {
    runs: typeof runs;
    totalDistance: number;
    totalDuration: number;
    coachNotes: Set<string>;
  }>();

  for (const run of runs) {
    const name = run.workout_name?.trim();
    if (!name) continue;

    if (!workoutMap.has(name)) {
      workoutMap.set(name, {
        runs: [],
        totalDistance: 0,
        totalDuration: 0,
        coachNotes: new Set(),
      });
    }

    const entry = workoutMap.get(name)!;
    entry.runs.push(run);
    entry.totalDistance += run.distance_km || 0;
    entry.totalDuration += run.duration_min || 0;
    if (run.coach_notes) {
      entry.coachNotes.add(run.coach_notes);
    }
  }

  // Convert to CoachWorkout format
  const workouts: Omit<CoachWorkout, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];

  for (const [name, data] of workoutMap.entries()) {
    const count = data.runs.length;
    const avgDistance = data.totalDistance / count;
    const avgDuration = data.totalDuration / count;
    const lastRun = data.runs[0]; // Already sorted by date desc

    // Infer category from workout name or run type
    const category = inferCategory(name, lastRun?.run_type);

    workouts.push({
      workout_name: name,
      category,
      typical_distance_km: Math.round(avgDistance * 10) / 10,
      typical_duration_min: Math.round(avgDuration),
      times_performed: count,
      last_performed: lastRun?.date?.split('T')[0],
      coach_notes: [...data.coachNotes].join('\n\n') || undefined,
      source: 'derived',
    });
  }

  return { workouts, analyzed: runs.length };
}

/**
 * Infer workout category from name or run type
 */
function inferCategory(workoutName: string, runType?: string): string {
  const nameLower = workoutName.toLowerCase();

  // Check workout name patterns
  if (nameLower.includes('easy') || nameLower.includes('recovery')) {
    return 'Easy';
  }
  if (nameLower.includes('tempo') || nameLower.includes('threshold')) {
    return 'Tempo';
  }
  if (nameLower.includes('interval') || nameLower.includes('repeat') || nameLower.includes('track')) {
    return 'Intervals';
  }
  if (nameLower.includes('long') || nameLower.includes('endurance')) {
    return 'Long Run';
  }
  if (nameLower.includes('fartlek')) {
    return 'Fartlek';
  }
  if (nameLower.includes('race') || nameLower.includes('competition')) {
    return 'Race';
  }
  if (nameLower.includes('warm') || nameLower.includes('cool')) {
    return 'Warmup/Cooldown';
  }

  // Fallback to run_type if available
  if (runType) {
    const typeLower = runType.toLowerCase();
    if (typeLower.includes('easy')) return 'Easy';
    if (typeLower.includes('tempo')) return 'Tempo';
    if (typeLower.includes('interval')) return 'Intervals';
    if (typeLower.includes('long')) return 'Long Run';
  }

  return 'Other';
}
