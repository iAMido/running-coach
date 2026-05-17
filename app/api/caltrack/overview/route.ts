import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

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
    const [profileRes, allMealsRes, weightRes, runsRes, waterRes] =
      await Promise.all([
        caltrackDb
          .from('user_profile')
          .select(
            'id,current_weight_kg,target_weight_kg,height_cm,age,sex,bmr,tdee,target_daily_calories'
          )
          .limit(1)
          .single(),
        // Fetch ALL meals in the date range (not just today)
        caltrackDb
          .from('meals')
          .select(
            'id,meal_type,total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,eaten_at'
          )
          .eq('status', 'confirmed')
          .gte('eaten_at', `${startStr}T00:00:00`)
          .lte('eaten_at', `${todayStr}T23:59:59`),
        caltrackDb
          .from('weight_log')
          .select('weight_kg,measured_at')
          .gte('measured_at', `${startStr}T00:00:00`)
          .order('measured_at', { ascending: true }),
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
    const allMeals = allMealsRes.data || [];
    const weights = weightRes.data || [];
    const allRuns = runsRes.data || [];
    const todayWaterLogs = waterRes.data || [];
    const targetCal = profile?.target_daily_calories || 2000;

    // Today's water total
    const todayWaterMl = todayWaterLogs.reduce(
      (sum: number, w: { amount_ml: number }) => sum + w.amount_ml,
      0
    );

    // Group meals by day (live data — always accurate)
    const mealsByDay: Record<
      string,
      { calories: number; protein: number; carbs: number; fat: number; fiber: number; count: number }
    > = {};

    for (const m of allMeals) {
      const mealDate = new Date(m.eaten_at);
      const day = mealDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      if (!day) continue;
      if (!mealsByDay[day])
        mealsByDay[day] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, count: 0 };
      mealsByDay[day].calories += m.total_calories || 0;
      mealsByDay[day].protein += m.total_protein_g || 0;
      mealsByDay[day].carbs += m.total_carbs_g || 0;
      mealsByDay[day].fat += m.total_fat_g || 0;
      mealsByDay[day].fiber += m.total_fiber_g || 0;
      mealsByDay[day].count += 1;
    }

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

    // Merge all dates that have any data (meals OR runs)
    const allDates = new Set<string>([
      ...Object.keys(mealsByDay),
      ...Object.keys(runsByDay),
    ]);
    const sortedDates = Array.from(allDates).sort();

    const trend = sortedDates.map((date) => {
      const meals = mealsByDay[date];
      const runs = runsByDay[date];
      const caloriesIn = meals?.calories || 0;
      const exerciseCalories = runs?.calories || 0;
      return {
        date,
        calories_in: caloriesIn,
        calories_out: exerciseCalories,
        net: caloriesIn - exerciseCalories,
        target: targetCal,
      };
    });

    // Today's data
    const todayExercise = runsByDay[todayStr] || {
      calories: 0,
      count: 0,
      distance: 0,
      duration: 0,
    };

    const todayData = mealsByDay[todayStr] || {
      calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, count: 0,
    };

    // Filter today's meals for the response
    const todayMeals = allMeals.filter((m) => {
      const mealDate = new Date(m.eaten_at);
      const day = mealDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      return day === todayStr;
    });

    const daysWithMeals = Object.values(mealsByDay).filter((d) => d.calories > 0).length;

    const totalMealCalories = Object.values(mealsByDay).reduce(
      (sum, d) => sum + d.calories,
      0
    );
    const avgCalories =
      daysWithMeals > 0 ? Math.round(totalMealCalories / daysWithMeals) : 0;

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
        calories: todayData.calories,
        target: targetCal,
        protein: Math.round(todayData.protein * 10) / 10,
        carbs: Math.round(todayData.carbs * 10) / 10,
        fat: Math.round(todayData.fat * 10) / 10,
        fiber: Math.round(todayData.fiber * 10) / 10,
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
