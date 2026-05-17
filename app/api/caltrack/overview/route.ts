import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
// RunCoach DB no longer needed — CalTrack has its own Strava sync

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
    const [profileRes, summariesRes, weightRes, todayMealsRes, runsRes, waterRes] =
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
        caltrackDb
          .from('caltrack_runs')
          .select('calories_burned,run_date,distance_km,duration_minutes')
          .gte('run_date', `${startStr}T00:00:00`)
          .lte('run_date', `${todayStr}T23:59:59`),
        caltrackDb
          .from('water_log')
          .select('amount_ml,logged_at')
          .gte('logged_at', `${todayStr}T00:00:00`)
          .lte('logged_at', `${todayStr}T23:59:59`),
      ]);

    const profile = profileRes.data;
    const summaries = summariesRes.data || [];
    const weights = weightRes.data || [];
    const todayMeals = todayMealsRes.data || [];
    const allRuns = runsRes.data || [];
    const todayWaterLogs = waterRes.data || [];
    const targetCal = profile?.target_daily_calories || 2000;

    // Today's water total
    const todayWaterMl = todayWaterLogs.reduce(
      (sum: number, w: { amount_ml: number }) => sum + w.amount_ml,
      0
    );

    // Build a map of exercise calories per day from caltrack_runs
    const runsByDay: Record<
      string,
      { calories: number; count: number; distance: number; duration: number }
    > = {};

    for (const r of allRuns) {
      const runDate = new Date(r.run_date);
      const day = runDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      if (!day) continue;
      if (!runsByDay[day])
        runsByDay[day] = { calories: 0, count: 0, distance: 0, duration: 0 };
      runsByDay[day].calories += r.calories_burned || 0;
      runsByDay[day].count += 1;
      runsByDay[day].distance += Number(r.distance_km) || 0;
      runsByDay[day].duration += r.duration_minutes || 0;
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

    // Override today's trend entry with live data from meals table
    // (daily_summary may be stale if the last update failed)
    if (todayCalories > 0 || todayMeals.length > 0) {
      const todayIdx = trend.findIndex((t) => t.date === todayStr);
      const todayExCal = todayExercise.calories;
      const todayEntry = {
        date: todayStr,
        calories_in: todayCalories,
        calories_out: todayExCal,
        net: todayCalories - todayExCal,
        target: targetCal,
      };
      if (todayIdx >= 0) {
        trend[todayIdx] = todayEntry;
      } else {
        trend.push(todayEntry);
      }
    }
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
        water_ml: todayWaterMl,
        water_target_ml: 2500,
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
