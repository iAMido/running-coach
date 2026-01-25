/**
 * Import TrainingPeaks workout data into coach_workouts table
 *
 * Usage: npx tsx scripts/import-trainingpeaks.ts <path-to-sqlite-db>
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TPRun {
  workout_name: string | null;
  coach_notes: string | null;
  date: string;
  distance_km: number | null;
  duration_min: number | null;
  avg_hr: number | null;
  run_type: string | null;
}

interface WorkoutStats {
  workout_name: string;
  count: number;
  avg_distance: number;
  avg_duration: number;
  coach_notes: Set<string>;
  run_types: Set<string>;
  dates: string[];
}

/**
 * Parse workout name to extract category and details
 */
function parseWorkoutName(name: string): {
  category: string;
  subCategory?: string;
  targetZone?: string;
  description?: string;
} {
  const nameLower = name.toLowerCase();

  // Recovery workouts
  if (nameLower.includes('recovery') || nameLower.includes('rpe 1-2') || nameLower.includes('rpe bas')) {
    return {
      category: 'Recovery',
      subCategory: 'Easy Recovery',
      targetZone: 'Z1',
      description: 'Easy recovery run at very low intensity',
    };
  }

  // VT1/LT1 workouts (threshold-related)
  if (nameLower.includes('vt1') || nameLower.includes('lt1')) {
    let subCategory = 'Aerobic Threshold';
    let targetZone = 'Z2-Z3';

    if (nameLower.includes('tempo')) {
      subCategory = 'Tempo';
      targetZone = 'Z3';
    } else if (nameLower.includes('hill')) {
      subCategory = 'Hill Reps';
      targetZone = 'Z3-Z4';
    } else if (nameLower.includes('pyramid')) {
      subCategory = 'Pyramid';
      targetZone = 'Z2-Z4';
    } else if (nameLower.includes('su')) {
      subCategory = 'Steady/Surge';
      targetZone = 'Z2-Z3';
    }

    return {
      category: 'Threshold',
      subCategory,
      targetZone,
      description: `Aerobic threshold workout at ${targetZone}`,
    };
  }

  // VO2 workouts
  if (nameLower.includes('vo2') || nameLower.includes('v02')) {
    return {
      category: 'Intervals',
      subCategory: 'VO2max',
      targetZone: 'Z5',
      description: 'High-intensity VO2max intervals',
    };
  }

  // Easy/Base workouts
  if (nameLower.includes('easy') || nameLower.includes('base')) {
    return {
      category: 'Easy',
      subCategory: 'Base',
      targetZone: 'Z2',
      description: 'Easy aerobic base building',
    };
  }

  // Aerobic-Anaerobic pyramid
  if (nameLower.includes('ae-an') || nameLower.includes('pyramid')) {
    return {
      category: 'Intervals',
      subCategory: 'Pyramid',
      targetZone: 'Z3-Z4',
      description: 'Aerobic-Anaerobic pyramid workout',
    };
  }

  // Long run
  if (nameLower.includes('long') || (parseInt(name.match(/(\d+)\s*m/i)?.[1] || '0') >= 90)) {
    return {
      category: 'Long Run',
      subCategory: 'Endurance',
      targetZone: 'Z2',
      description: 'Long endurance run',
    };
  }

  // Default
  return {
    category: 'Other',
    description: name,
  };
}

/**
 * Parse coach notes to extract structure
 */
function parseCoachNotes(notes: string): {
  structure: string[];
  whenToUse?: string;
  intensity?: string;
} {
  if (!notes || notes.trim() === '') {
    return { structure: [] };
  }

  // Split by pipe character
  const parts = notes.split('|').map(p => p.trim()).filter(Boolean);

  // Check for RPE notes
  if (notes.toLowerCase().includes('rpe')) {
    const rpeMatch = notes.match(/rpe\s*(\d+(?:-\d+)?)/i);
    return {
      structure: parts,
      intensity: rpeMatch ? `RPE ${rpeMatch[1]}` : undefined,
      whenToUse: 'Recovery day or day after hard effort',
    };
  }

  return { structure: parts };
}

/**
 * Infer training phase from run type
 */
function inferPhase(runType: string | null): string | undefined {
  if (!runType) return undefined;

  const typeLower = runType.toLowerCase();
  if (typeLower.includes('base')) return 'Base';
  if (typeLower.includes('build')) return 'Build';
  if (typeLower.includes('specific') || typeLower.includes('peak')) return 'Specific';
  if (typeLower.includes('taper') || typeLower.includes('race')) return 'Taper';

  return undefined;
}

async function main() {
  const dbPath = process.argv[2];

  if (!dbPath) {
    console.error('Usage: npx tsx scripts/import-trainingpeaks.ts <path-to-sqlite-db>');
    process.exit(1);
  }

  console.log(`Opening database: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  // Get user ID (you'll need to provide this)
  const userId = process.argv[3] || process.env.DEFAULT_USER_ID;

  if (!userId) {
    console.error('Please provide user ID as third argument or set DEFAULT_USER_ID env var');
    process.exit(1);
  }

  console.log(`Importing for user: ${userId}`);

  // Fetch all runs with workout names
  const runs = db.prepare(`
    SELECT workout_name, coach_notes, date, distance_km, duration_min, avg_hr, run_type
    FROM runs
    WHERE workout_name IS NOT NULL AND workout_name != ''
    ORDER BY date DESC
  `).all() as TPRun[];

  console.log(`Found ${runs.length} runs with workout names`);

  // Group by workout name
  const workoutMap = new Map<string, WorkoutStats>();

  for (const run of runs) {
    const name = run.workout_name?.trim();
    if (!name || name.startsWith('Run 202')) continue; // Skip generic "Run 2023-xx-xx" names

    if (!workoutMap.has(name)) {
      workoutMap.set(name, {
        workout_name: name,
        count: 0,
        avg_distance: 0,
        avg_duration: 0,
        coach_notes: new Set(),
        run_types: new Set(),
        dates: [],
      });
    }

    const stats = workoutMap.get(name)!;
    stats.count++;
    stats.avg_distance += run.distance_km || 0;
    stats.avg_duration += run.duration_min || 0;
    if (run.coach_notes) stats.coach_notes.add(run.coach_notes);
    if (run.run_type) stats.run_types.add(run.run_type);
    stats.dates.push(run.date);
  }

  console.log(`Found ${workoutMap.size} unique workout types`);

  // Convert to coach_workouts format
  const workouts: Array<{
    user_id: string;
    workout_name: string;
    category: string;
    sub_category?: string;
    target_zone?: string;
    description?: string;
    typical_distance_km?: number;
    typical_duration_min?: number;
    coach_notes?: string;
    training_phase?: string;
    times_performed: number;
    last_performed?: string;
    source: string;
  }> = [];

  for (const [name, stats] of workoutMap.entries()) {
    const parsed = parseWorkoutName(name);
    const notesArray = [...stats.coach_notes];
    const parsedNotes = notesArray.length > 0 ? parseCoachNotes(notesArray[0]) : { structure: [] };
    const phase = [...stats.run_types][0] ? inferPhase([...stats.run_types][0]) : undefined;

    workouts.push({
      user_id: userId,
      workout_name: name,
      category: parsed.category,
      sub_category: parsed.subCategory,
      target_zone: parsed.targetZone,
      description: parsed.description,
      typical_distance_km: Math.round((stats.avg_distance / stats.count) * 10) / 10,
      typical_duration_min: Math.round(stats.avg_duration / stats.count),
      coach_notes: notesArray.join('\n\n') || undefined,
      training_phase: phase,
      times_performed: stats.count,
      last_performed: stats.dates[0]?.split('T')[0],
      source: 'trainingpeaks',
    });
  }

  console.log(`Prepared ${workouts.length} workouts for import`);

  // Insert into Supabase
  let inserted = 0;
  let errors = 0;

  for (const workout of workouts) {
    const { error } = await supabase
      .from('coach_workouts')
      .upsert(workout, { onConflict: 'user_id,workout_name' });

    if (error) {
      console.error(`Error inserting "${workout.workout_name}":`, error.message);
      errors++;
    } else {
      inserted++;
      console.log(`✓ Imported: ${workout.workout_name} (${workout.times_performed}x)`);
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Errors: ${errors}`);

  db.close();
}

main().catch(console.error);
