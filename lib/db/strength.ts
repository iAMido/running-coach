import { supabase } from './supabase';
import { StrengthExercise, StrengthTemplate, WeeklyStrength } from './types';

/**
 * Get a strength template by phase (base, build, or specific)
 */
export async function getStrengthTemplateByPhase(
  phase: 'base' | 'build' | 'specific'
): Promise<StrengthTemplate | null> {
  const { data, error } = await supabase
    .from('strength_templates')
    .select('*')
    .eq('phase', phase)
    .single();

  if (error) {
    console.error('Error fetching strength template:', error);
    return null;
  }

  return data;
}

/**
 * Get a strength exercise by ID
 */
export async function getExerciseById(id: string): Promise<StrengthExercise | null> {
  const { data, error } = await supabase
    .from('strength_exercises')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching exercise:', error);
    return null;
  }

  return data;
}

/**
 * Get multiple exercises by their IDs (maintains order)
 */
export async function getExercisesByIds(ids: string[]): Promise<StrengthExercise[]> {
  if (!ids || ids.length === 0) return [];

  const { data, error } = await supabase
    .from('strength_exercises')
    .select('*')
    .in('id', ids);

  if (error) {
    console.error('Error fetching exercises:', error);
    return [];
  }

  // Maintain the order from the input ids array
  const exerciseMap = new Map(data.map((ex: StrengthExercise) => [ex.id, ex]));
  return ids.map(id => exerciseMap.get(id)).filter(Boolean) as StrengthExercise[];
}

/**
 * Get all strength exercises
 */
export async function getAllExercises(): Promise<StrengthExercise[]> {
  const { data, error } = await supabase
    .from('strength_exercises')
    .select('*')
    .order('category')
    .order('name');

  if (error) {
    console.error('Error fetching all exercises:', error);
    return [];
  }

  return data || [];
}

/**
 * Determine phase based on week number in plan
 * Base: weeks 1-3
 * Build: weeks 4-6
 * Specific: weeks 7+
 */
export function getPhaseForWeek(weekNumber: number, totalWeeks: number): 'base' | 'build' | 'specific' {
  // For short plans (< 6 weeks), simplify
  if (totalWeeks <= 4) {
    if (weekNumber <= Math.ceil(totalWeeks / 2)) return 'base';
    return 'specific';
  }

  // For typical plans, use thirds
  const baseEnd = Math.ceil(totalWeeks / 3);
  const buildEnd = Math.ceil((totalWeeks * 2) / 3);

  if (weekNumber <= baseEnd) return 'base';
  if (weekNumber <= buildEnd) return 'build';
  return 'specific';
}

/**
 * Get the weekly strength workout based on current plan week
 * Returns exercises with full details for display
 */
export async function getWeeklyStrength(
  weekNumber: number,
  totalWeeks: number
): Promise<WeeklyStrength | null> {
  // Determine which phase based on week number
  const phase = getPhaseForWeek(weekNumber, totalWeeks);

  // Get the template for this phase
  const template = await getStrengthTemplateByPhase(phase);
  if (!template) {
    console.error(`No template found for phase: ${phase}`);
    return null;
  }

  // Get all exercises for this template
  const exercises = await getExercisesByIds(template.exercise_ids);
  if (exercises.length === 0) {
    console.error('No exercises found for template');
    return null;
  }

  return {
    phase,
    template_name: template.name,
    duration_minutes: template.duration_minutes,
    notes: template.notes,
    exercises: exercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      sets_reps: ex.default_sets_reps,
      youtube_url: ex.youtube_url,
      description: ex.description,
      coaching_cues: ex.coaching_cues,
      category: ex.category,
      equipment: ex.equipment,
    })),
  };
}

/**
 * Get all exercises for a specific phase
 */
export async function getExercisesForPhase(
  phase: 'base' | 'build' | 'specific'
): Promise<StrengthExercise[]> {
  const { data, error } = await supabase
    .from('strength_exercises')
    .select('*')
    .contains('phases', [phase])
    .order('category')
    .order('name');

  if (error) {
    console.error('Error fetching exercises for phase:', error);
    return [];
  }

  return data || [];
}
