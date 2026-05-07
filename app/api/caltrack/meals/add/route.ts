import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
import { randomUUID } from 'crypto';

interface IngredientInput {
  name_en: string;
  name_he?: string;
  fdc_id?: number | null;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

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
    const { meal_type, ingredients } = body as {
      meal_type: string;
      ingredients: IngredientInput[];
    };

    if (!meal_type || !ingredients || !ingredients.length) {
      return NextResponse.json(
        { error: 'Missing meal_type or ingredients' },
        { status: 400 }
      );
    }

    const profileRes = await caltrackDb
      .from('user_profile')
      .select('id,target_daily_calories')
      .limit(1)
      .single();

    if (!profileRes.data) {
      return NextResponse.json({ error: 'No user profile found' }, { status: 404 });
    }

    const userId = profileRes.data.id;
    const mealId = randomUUID();
    const now = new Date().toISOString();

    const totals = ingredients.reduce(
      (acc, ing) => ({
        calories: acc.calories + (ing.calories || 0),
        protein: acc.protein + (ing.protein_g || 0),
        carbs: acc.carbs + (ing.carbs_g || 0),
        fat: acc.fat + (ing.fat_g || 0),
        fiber: acc.fiber + (ing.fiber_g || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    const { error: mealError } = await caltrackDb.from('meals').insert({
      id: mealId,
      user_id: userId,
      meal_type,
      eaten_at: now,
      total_calories: totals.calories,
      total_protein_g: Math.round(totals.protein * 10) / 10,
      total_carbs_g: Math.round(totals.carbs * 10) / 10,
      total_fat_g: Math.round(totals.fat * 10) / 10,
      total_fiber_g: Math.round(totals.fiber * 10) / 10,
      status: 'confirmed',
    });

    if (mealError) throw mealError;

    for (const ing of ingredients) {
      const { error: itemError } = await caltrackDb.from('meal_items').insert({
        meal_id: mealId,
        ingredient_name: ing.name_en,
        fdc_id: ing.fdc_id || null,
        weight_grams: Math.round(ing.grams),
        weight_source: 'dashboard_ai',
        calories: ing.calories,
        protein_g: ing.protein_g,
        carbs_g: ing.carbs_g,
        fat_g: ing.fat_g,
        fiber_g: ing.fiber_g,
      });
      if (itemError) throw itemError;
    }

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
      const dayTotals = dayMeals.reduce(
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
          total_calories_in: dayTotals.cal,
          total_protein_g: Math.round(dayTotals.pro * 10) / 10,
          total_carbs_g: Math.round(dayTotals.carb * 10) / 10,
          total_fat_g: Math.round(dayTotals.fat * 10) / 10,
          total_fiber_g: Math.round(dayTotals.fib * 10) / 10,
          target_calories: profileRes.data.target_daily_calories || 2000,
          net_calories: dayTotals.cal,
        },
        { onConflict: 'user_id,date' }
      );
    }

    return NextResponse.json({
      meal_id: mealId,
      totals,
      items: ingredients.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('CalTrack add meal error:', msg, error);
    return NextResponse.json(
      { error: `Failed to add meal: ${msg}` },
      { status: 500 }
    );
  }
}
