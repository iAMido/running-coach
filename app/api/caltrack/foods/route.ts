import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

export async function GET() {
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
    // Fetch meal_items aggregation
    const { data: mealItems, error: mealError } = await caltrackDb
      .from('meal_items')
      .select('ingredient_name,weight_grams,calories,protein_g,carbs_g,fat_g');

    if (mealError) throw mealError;

    // Fetch personal foods
    const { data: personalFoods, error: pfError } = await caltrackDb
      .from('personal_foods')
      .select(
        'id,ingredient_name,total_times_logged,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g'
      );

    if (pfError) throw pfError;

    // Build personal foods map
    const personalMap = new Map<
      string,
      {
        id: string;
        calories_per_100g: number | null;
        protein_per_100g: number | null;
        carbs_per_100g: number | null;
        fat_per_100g: number | null;
      }
    >();
    for (const pf of personalFoods || []) {
      personalMap.set(pf.ingredient_name.toLowerCase(), {
        id: pf.id,
        calories_per_100g: pf.calories_per_100g,
        protein_per_100g: pf.protein_per_100g,
        carbs_per_100g: pf.carbs_per_100g,
        fat_per_100g: pf.fat_per_100g,
      });
    }

    // Aggregate meal_items
    const agg: Record<
      string,
      {
        count: number;
        totalCal: number;
        totalWeight: number;
        totalProtein: number;
        totalCarbs: number;
        totalFat: number;
      }
    > = {};

    for (const item of mealItems || []) {
      const name = item.ingredient_name;
      if (!agg[name]) {
        agg[name] = {
          count: 0,
          totalCal: 0,
          totalWeight: 0,
          totalProtein: 0,
          totalCarbs: 0,
          totalFat: 0,
        };
      }
      agg[name].count++;
      agg[name].totalCal += item.calories || 0;
      agg[name].totalWeight += item.weight_grams || 0;
      agg[name].totalProtein += item.protein_g || 0;
      agg[name].totalCarbs += item.carbs_g || 0;
      agg[name].totalFat += item.fat_g || 0;
    }

    const foods = Object.entries(agg)
      .map(([name, stats]) => {
        const personal = personalMap.get(name.toLowerCase());
        // Compute per-100g from meal data if not in personal_foods
        const avgWeight = stats.totalWeight / stats.count;
        const computedPer100g =
          avgWeight > 0
            ? {
                calories: Math.round(
                  (stats.totalCal / stats.count / avgWeight) * 100
                ),
                protein: Math.round(
                  ((stats.totalProtein / stats.count / avgWeight) * 100) * 10
                ) / 10,
                carbs: Math.round(
                  ((stats.totalCarbs / stats.count / avgWeight) * 100) * 10
                ) / 10,
                fat: Math.round(
                  ((stats.totalFat / stats.count / avgWeight) * 100) * 10
                ) / 10,
              }
            : null;

        return {
          ingredient_name: name,
          total_count: stats.count,
          avg_calories: Math.round(stats.totalCal / stats.count),
          avg_weight: Math.round(avgWeight),
          is_personal: !!personal,
          personal_food_id: personal?.id || null,
          per_100g: personal
            ? {
                calories: personal.calories_per_100g,
                protein: personal.protein_per_100g,
                carbs: personal.carbs_per_100g,
                fat: personal.fat_per_100g,
              }
            : computedPer100g,
        };
      })
      .sort((a, b) => b.total_count - a.total_count);

    return NextResponse.json({ foods });
  } catch (error) {
    console.error('CalTrack foods error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch food data' },
      { status: 500 }
    );
  }
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
    const { ingredient_name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g } =
      body;

    if (!ingredient_name) {
      return NextResponse.json(
        { error: 'ingredient_name is required' },
        { status: 400 }
      );
    }

    // Upsert into personal_foods
    const { data, error } = await caltrackDb
      .from('personal_foods')
      .upsert(
        {
          ingredient_name,
          calories_per_100g: calories_per_100g ?? null,
          protein_per_100g: protein_per_100g ?? null,
          carbs_per_100g: carbs_per_100g ?? null,
          fat_per_100g: fat_per_100g ?? null,
          last_logged_at: new Date().toISOString(),
        },
        { onConflict: 'ingredient_name' }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, food: data });
  } catch (error) {
    console.error('CalTrack foods POST error:', error);
    return NextResponse.json(
      { error: 'Failed to save personal food' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    const { error } = await caltrackDb
      .from('personal_foods')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('CalTrack foods DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete personal food' },
      { status: 500 }
    );
  }
}
