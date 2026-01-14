/**
 * Migration script: SQLite to Supabase
 *
 * Usage:
 * 1. Set environment variables in .env.local
 * 2. Run with Bun: bun run scripts/migrate-sqlite-to-supabase.ts
 */

import { Database } from 'bun:sqlite';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        const value = trimmed.substring(eqIndex + 1);
        process.env[key] = value;
      }
    }
  }
}

// Configuration
const SQLITE_PATH = 'C:\\Users\\ido\\RunningCoach\\master_running_data.db';
const USER_ID = 'idomosseri@gmail.com'; // Your email from Google OAuth

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for migration

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log('Starting migration from SQLite to Supabase...\n');

  // Open SQLite database using Bun's built-in SQLite
  const db = new Database(SQLITE_PATH, { readonly: true });

  try {
    // 1. Migrate runs
    console.log('Migrating runs...');
    const runs = db.query('SELECT * FROM runs').all() as Record<string, unknown>[];
    console.log(`  Found ${runs.length} runs`);

    for (const run of runs) {
      const { error } = await supabase.from('runs').insert({
        user_id: USER_ID,
        filename: run.filename as string,
        date: run.date as string,
        distance_km: run.distance_km as number,
        duration_min: run.duration_min as number,
        duration_sec: Math.round(run.duration_sec as number || 0),
        avg_hr: Math.round(run.avg_hr as number || 0) || null,
        max_hr: Math.round(run.max_hr as number || 0) || null,
        avg_pace_min_km: run.avg_pace_min_km as number,
        avg_pace_str: run.avg_pace_str as string,
        calories: Math.round(run.calories as number || 0) || null,
        run_type: run.run_type as string,
        workout_name: run.workout_name as string,
        coach_notes: run.coach_notes as string,
        trimp: run.trimp as number,
        data_source: run.data_source as string,
        pct_z1: run.pct_Z1 as number,
        pct_z2: run.pct_Z2 as number,
        pct_z3: run.pct_Z3 as number,
        pct_z4: run.pct_Z4 as number,
        pct_z5: run.pct_Z5 as number,
        pct_z6: run.pct_Z6 as number,
      });

      if (error) {
        console.error(`  Error inserting run ${run.filename}:`, error.message);
      }
    }
    console.log(`  Migrated ${runs.length} runs\n`);

    // 2. Migrate athlete profile
    console.log('Migrating athlete profile...');
    const profileRows = db.query('SELECT key, value FROM athlete_profile').all() as { key: string; value: string }[];
    const profile: Record<string, string> = {};
    for (const row of profileRows) {
      profile[row.key] = row.value;
    }

    if (Object.keys(profile).length > 0) {
      const { error } = await supabase.from('athlete_profile').upsert({
        user_id: USER_ID,
        name: profile.name,
        age: parseInt(profile.age) || null,
        weight_kg: parseFloat(profile.weight_kg) || null,
        resting_hr: parseInt(profile.resting_hr) || null,
        max_hr: parseInt(profile.max_hr) || null,
        lactate_threshold_hr: parseInt(profile.lactate_threshold_hr) || null,
        current_goal: profile.current_goal,
        training_days: profile.training_days,
        injury_history: profile.injury_history,
        hr_zone_z1: profile.hr_zone_z1,
        hr_zone_z2: profile.hr_zone_z2,
        hr_zone_z3: profile.hr_zone_z3,
        hr_zone_z4: profile.hr_zone_z4,
        hr_zone_z5: profile.hr_zone_z5,
        hr_zone_z6: profile.hr_zone_z6,
      }, { onConflict: 'user_id' });

      if (error) {
        console.error('  Error inserting profile:', error.message);
      } else {
        console.log('  Migrated athlete profile\n');
      }
    }

    // 3. Migrate training plans
    console.log('Migrating training plans...');
    try {
      const plans = db.query('SELECT * FROM training_plans').all() as Record<string, unknown>[];
      console.log(`  Found ${plans.length} training plans`);

      for (const plan of plans) {
        let planJson = plan.plan_json;
        if (typeof planJson === 'string') {
          try {
            planJson = JSON.parse(planJson);
          } catch {
            planJson = { raw: planJson };
          }
        }

        const { error } = await supabase.from('training_plans').insert({
          user_id: USER_ID,
          plan_type: plan.plan_type as string,
          plan_json: planJson,
          duration_weeks: plan.duration_weeks as number,
          status: plan.status as string || 'completed',
          start_date: plan.start_date as string,
          current_week_num: plan.current_week_num as number || 1,
        });

        if (error) {
          console.error(`  Error inserting plan:`, error.message);
        }
      }
      console.log(`  Migrated ${plans.length} training plans\n`);
    } catch (e) {
      console.log('  No training_plans table found, skipping\n');
    }

    // 4. Migrate run feedback
    console.log('Migrating run feedback...');
    try {
      const feedback = db.query('SELECT * FROM run_feedback').all() as Record<string, unknown>[];
      console.log(`  Found ${feedback.length} feedback entries`);

      for (const fb of feedback) {
        const { error } = await supabase.from('run_feedback').insert({
          user_id: USER_ID,
          run_date: fb.run_date as string,
          rating: fb.rating as number,
          effort_level: fb.effort_level as number,
          feeling: fb.feeling as string,
          comment: fb.comment as string,
        });

        if (error) {
          console.error(`  Error inserting feedback:`, error.message);
        }
      }
      console.log(`  Migrated ${feedback.length} feedback entries\n`);
    } catch (e) {
      console.log('  No run_feedback table found, skipping\n');
    }

    // 5. Migrate weekly summaries
    console.log('Migrating weekly summaries...');
    try {
      const summaries = db.query('SELECT * FROM weekly_summaries').all() as Record<string, unknown>[];
      console.log(`  Found ${summaries.length} weekly summaries`);

      for (const summary of summaries) {
        const { error } = await supabase.from('weekly_summaries').insert({
          user_id: USER_ID,
          week_start: summary.week_start as string,
          overall_feeling: summary.overall_feeling as number,
          sleep_quality: summary.sleep_quality as number,
          stress_level: summary.stress_level as number,
          injury_notes: summary.injury_notes as string,
          achievements: summary.achievements as string,
          ai_analysis: summary.ai_analysis as string,
        });

        if (error) {
          console.error(`  Error inserting summary:`, error.message);
        }
      }
      console.log(`  Migrated ${summaries.length} weekly summaries\n`);
    } catch (e) {
      console.log('  No weekly_summaries table found, skipping\n');
    }

    // 6. Migrate workout library
    console.log('Migrating workout library...');
    try {
      const workouts = db.query('SELECT * FROM workout_library').all() as Record<string, unknown>[];
      console.log(`  Found ${workouts.length} workout types`);

      for (const workout of workouts) {
        const { error } = await supabase.from('workout_library').insert({
          user_id: USER_ID,
          workout_name: workout.workout_name as string,
          coach_notes: workout.coach_notes as string,
          category: workout.category as string,
          typical_distance_km: workout.typical_distance_km as number,
          typical_duration_min: workout.typical_duration_min as number,
          target_zone: workout.target_zone as string,
          purpose: workout.purpose as string,
          count: workout.count as number || 0,
        });

        if (error) {
          console.error(`  Error inserting workout:`, error.message);
        }
      }
      console.log(`  Migrated ${workouts.length} workout types\n`);
    } catch (e) {
      console.log('  No workout_library table found, skipping\n');
    }

    console.log('Migration complete!');
    console.log('\nSummary:');
    console.log(`  Runs: ${runs.length}`);
    console.log(`  Profile: migrated`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    db.close();
  }
}

migrate().catch(console.error);
