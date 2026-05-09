import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
import { supabase as runcoachDb } from '@/lib/db/supabase';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isCaltrackConfigured()) {
    return NextResponse.json(
      { error: 'CalTrack database not configured' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const days = Math.min(parseInt(searchParams.get('days') || '7'), 365);

  // Use Israel timezone for date calculations
  const nowIsrael = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })
  );
  let startStr: string;
  let todayStr: string;

  if (fromParam && toParam) {
    startStr = fromParam;
    todayStr = toParam;
  } else {
    const startDate = new Date(nowIsrael);
    startDate.setDate(startDate.getDate() - days);
    startStr = startDate.toISOString().split('T')[0];
    todayStr = nowIsrael.toISOString().split('T')[0];
  }

  try {
    const [profileRes, summariesRes, weightRes, todayMealsRes, runsRes, stravaRunsRes] =
      await Promise.all([
        caltrackDb
          .from('user_profile')
          .select(
            'id,current_weight_kg,target_weight_kg,height_cm,age,sex,bmr,tdee,target_daily_calories'
          )
          .limit(1)
          .single(),
        caltrackDb
          .from('daily_summary')
          .select('*')
          .gte('date', startStr)
          .lte('date', todayStr)
          .order('date', { ascending: true }),
        caltrackDb
          .from('weight_log')
          .select('weight_kg,measured_at')
          .gte('measured_at', `${startStr}T00:00:00`)
          .order('measured_at', { ascending: true }),
        caltrackDb
          .from('meals')
          .select(
            'id,meal_type,total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,eaten_at'
          )
          .eq('status', 'confirmed')
          .gte('eaten_at', `${todayStr}T00:00:00`)
          .lte('eaten_at', `${todayStr}T23:59:59`),
        // CalTrack manual runs
        caltrackDb
          .from('caltrack_runs')
          .select('calories_burned,run_date,distance_km,duration_minutes')
          .gte('run_date', `${startStr}T00:00:00`)
          .lte('run_date', `${todayStr}T23:59:59`),
        // RunCoach Strava-synced runs (separate Supabase project)
        runcoachDb
          .from('runs')
          .select('distance_km,duration_min,avg_hr,date,calories')
          .gte('date', `${startStr}T00:00:00`)
          .lte('date', `${todayStr}T23:59:59`),
      ]);

    const profile = profileRes.data;
    const summaries = summariesRes.data || [];
    const weights = weightRes.data || [];
    const todayMeals = todayMealsRes.data || [];
    const caltrackRuns = runsRes.data || [];
    const stravaRuns = stravaRunsRes.data || [];
    const targetCal = profile?.target_daily_calories || 2000;
    const userWeightKg = profile?.current_weight_kg || 80;

    // Estimate calories burned from running: ~1 kcal/kg/km (standard formula)
    function estimateRunCalories(distanceKm: number, durationMin: number, weightKg: number): number {
      // MET-based: running ~8-10 MET depending on pace
      const paceMinPerKm = durationMin / (distanceKm || 1);
      let met = 10; // default ~6:00/km
      if (paceMinPerKm > 8) met = 7;       // slow jog
      else if (paceMinPerKm > 7) met = 8;  // easy
      else if (paceMinPerKm > 6) met = 9.5; // moderate
      else if (paceMinPerKm > 5) met = 11; // fast
      else met = 12.5;                      // race pace
      return Math.round(met * weightKg * (durationMin / 60));
    }

    // Build a map of exercise calories per day
    const runsByDay: Record<
      string,
      { calories: number; count: number; distance: number; duration: number }
    > = {};

    // Helper to add a run to the map
    function addRun(day: string, calories: number, distance: number, duration: number) {
      if (!day) return;
      if (!runsByDay[day])
        runsByDay[day] = { calories: 0, count: 0, distance: 0, duration: 0 };
      runsByDay[day].calories += calories;
      runsByDay[day].count += 1;
      runsByDay[day].distance += distance;
      runsByDay[day].duration += duration;
    }

    // CalTrack manual runs
    for (const r of caltrackRuns) {
      const runDate = new Date(r.run_date);
      const day = runDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      addRun(day, r.calories_burned || 0, r.distance_km || 0, r.duration_minutes || 0);
    }

    // RunCoach Strava-synced runs
    for (const r of stravaRuns) {
      const runDate = new Date(r.date);
      const day = runDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const dist = Number(r.distance_km) || 0;
      const dur = Number(r.duration_min) || 0;
      const cal = r.calories || estimateRunCalories(dist, dur, userWeightKg);
      addRun(day, cal, dist, dur);
    }

    // Build a map from daily_summary
    const summaryByDay: Record<
      string,
      { calories_in: number; calories_out: number; target: number }
    > = {};
    for (const s of summaries) {
      summaryByDay[s.date] = {
        calories_in: s.total_calories_in || 0,
        calories_out: s.total_calories_out || 0,
        target: s.target_calories || targetCal,
      };
    }

    // Merge all dates that have any data (summary OR runs)
    const allDates = new Set<string>([
      ...Object.keys(summaryByDay),
      ...Object.keys(runsByDay),
    ]);
    const sortedDates = Array.from(allDates).sort();

    const trend = sortedDates.map((date) => {
      const summary = summaryByDay[date];
      const runs = runsByDay[date];
      const caloriesIn = summary?.calories_in || 0;
      const exerciseFromSummary = summary?.calories_out || 0;
      const exerciseFromRuns = runs?.calories || 0;
      const exerciseCalories = Math.max(exerciseFromSummary, exerciseFromRuns);
      return {
        date,
        calories_in: caloriesIn,
        calories_out: exerciseCalories,
        net: caloriesIn - exerciseCalories,
        target: summary?.target || targetCal,
      };
    });

    // Today's exercise
    const todayExercise = runsByDay[todayStr] || {
      calories: 0,
      count: 0,
      distance: 0,
      duration: 0,
    };

    const todayCalories = todayMeals.reduce(
      (sum: number, m: { total_calories: number }) =>
        sum + (m.total_calories || 0),
      0
    );
    const todayProtein = todayMeals.reduce(
      (sum: number, m: { total_protein_g: number }) =>
        sum + (m.total_protein_g || 0),
      0
    );
    const todayCarbs = todayMeals.reduce(
      (sum: number, m: { total_carbs_g: number }) =>
        sum + (m.total_carbs_g || 0),
      0
    );
    const todayFat = todayMeals.reduce(
      (sum: number, m: { total_fat_g: number }) => sum + (m.total_fat_g || 0),
      0
    );
    const todayFiber = todayMeals.reduce(
      (sum: number, m: { total_fiber_g: number }) =>
        sum + (m.total_fiber_g || 0),
      0
    );

    const daysWithMeals = summaries.filter(
      (s: { total_calories_in: number }) => (s.total_calories_in || 0) > 0
    ).length;

    const avgCalories =
      daysWithMeals > 0
        ? Math.round(
            summaries.reduce(
              (sum: number, s: { total_calories_in: number }) =>
                sum + (s.total_calories_in || 0),
              0
            ) / daysWithMeals
          )
        : 0;

    const weightTrend = weights.map(
      (w: { measured_at: string; weight_kg: number }) => ({
        date: w.measured_at.split('T')[0],
        weight: w.weight_kg,
      })
    );

    // Total exercise calories across the period
    const totalExerciseCalories = Object.values(runsByDay).reduce(
      (sum, d) => sum + d.calories,
      0
    );
    const totalExerciseRuns = Object.values(runsByDay).reduce(
      (sum, d) => sum + d.count,
      0
    );

    return NextResponse.json({
      profile,
      today: {
        calories: todayCalories,
        target: targetCal,
        protein: Math.round(todayProtein * 10) / 10,
        carbs: Math.round(todayCarbs * 10) / 10,
        fat: Math.round(todayFat * 10) / 10,
        fiber: Math.round(todayFiber * 10) / 10,
        meals: todayMeals.length,
        exercise: todayExercise.calories,
        exerciseRuns: todayExercise.count,
        exerciseDistance: Math.round(todayExercise.distance * 10) / 10,
      },
      stats: {
        avgCalories,
        daysWithData: daysWithMeals,
        currentWeight: profile?.current_weight_kg,
        targetWeight: profile?.target_weight_kg,
        totalExerciseCalories,
        totalExerciseRuns,
      },
      trend,
      weightTrend,
    });
  } catch (error) {
    console.error('CalTrack overview error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch overview data' },
      { status: 500 }
    );
  }
}
