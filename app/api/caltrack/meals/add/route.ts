import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
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

  try {
    const body = await request.json();
    const { meal_type, food_name, weight_grams } = body;

    if (!meal_type || !food_name || !weight_grams) {
      return NextResponse.json(
        { error: 'Missing required fields: meal_type, food_name, weight_grams' },
        { status: 400 }
      );
    }

    const grams = Math.max(1, Math.min(5000, Number(weight_grams)));

    const profileRes = await caltrackDb
      .from('user_profile')
      .select('id,target_daily_calories')
      .limit(1)
      .single();

    if (!profileRes.data) {
      return NextResponse.json({ error: 'No user profile found' }, { status: 404 });
    }

    const userId = profileRes.data.id;

    const { data: usdaMatches } = await caltrackDb
      .from('usda_foundation')
      .select('fdc_id,description,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g')
      .ilike('description', `%${food_name}%`)
      .limit(5);

    let nutrition: {
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g: number;
      fdc_id: number | null;
      source: string;
    };

    if (usdaMatches && usdaMatches.length > 0) {
      const match = usdaMatches[0];
      const factor = grams / 100;
      nutrition = {
        calories: Math.round((match.calories_per_100g || 0) * factor),
        protein_g: Math.round(((match.protein_per_100g || 0) * factor) * 10) / 10,
        carbs_g: Math.round(((match.carbs_per_100g || 0) * factor) * 10) / 10,
        fat_g: Math.round(((match.fat_per_100g || 0) * factor) * 10) / 10,
        fiber_g: Math.round(((match.fiber_per_100g || 0) * factor) * 10) / 10,
        fdc_id: match.fdc_id,
        source: 'usda',
      };
    } else {
      return NextResponse.json({
        error: 'Food not found in USDA database. Try a different name (in English).',
        suggestions: [],
      }, { status: 404 });
    }

    const mealId = randomUUID();
    const now = new Date().toISOString();

    const { error: mealError } = await caltrackDb.from('meals').insert({
      id: mealId,
      user_id: userId,
      meal_type,
      eaten_at: now,
      total_calories: nutrition.calories,
      total_protein_g: nutrition.protein_g,
      total_carbs_g: nutrition.carbs_g,
      total_fat_g: nutrition.fat_g,
      total_fiber_g: nutrition.fiber_g,
      status: 'confirmed',
    });

    if (mealError) throw mealError;

    const { error: itemError } = await caltrackDb.from('meal_items').insert({
      meal_id: mealId,
      ingredient_name: food_name,
      fdc_id: nutrition.fdc_id,
      weight_grams: grams,
      weight_source: 'dashboard',
      calories: nutrition.calories,
      protein_g: nutrition.protein_g,
      carbs_g: nutrition.carbs_g,
      fat_g: nutrition.fat_g,
      fiber_g: nutrition.fiber_g,
    });

    if (itemError) throw itemError;

    // Refresh daily summary
    const todayStr = now.split('T')[0];
    const { data: dayMeals } = await caltrackDb
      .from('meals')
      .select('total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('eaten_at', `${todayStr}T00:00:00`)
      .lte('eaten_at', `${todayStr}T23:59:59`);

    if (dayMeals) {
      const totals = dayMeals.reduce(
        (acc, m) => ({
          cal: acc.cal + (m.total_calories || 0),
          pro: acc.pro + (m.total_protein_g || 0),
          carb: acc.carb + (m.total_carbs_g || 0),
          fat: acc.fat + (m.total_fat_g || 0),
          fib: acc.fib + (m.total_fiber_g || 0),
        }),
        { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 }
      );

      await caltrackDb.from('daily_summary').upsert(
        {
          user_id: userId,
          date: todayStr,
          total_calories_in: totals.cal,
          total_protein_g: Math.round(totals.pro * 10) / 10,
          total_carbs_g: Math.round(totals.carb * 10) / 10,
          total_fat_g: Math.round(totals.fat * 10) / 10,
          total_fiber_g: Math.round(totals.fib * 10) / 10,
          target_calories: profileRes.data.target_daily_calories || 2000,
          net_calories: totals.cal,
        },
        { onConflict: 'user_id,date' }
      );
    }

    return NextResponse.json({
      meal_id: mealId,
      nutrition,
      message: `Added ${grams}g ${food_name} (${nutrition.calories} kcal)`,
    });
  } catch (error) {
    console.error('CalTrack add meal error:', error);
    return NextResponse.json(
      { error: 'Failed to add meal' },
      { status: 500 }
    );
  }
}
