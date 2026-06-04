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
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const mealType = searchParams.get('meal_type');
  const mealId = searchParams.get('id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    if (mealId) {
      const [mealRes, itemsRes] = await Promise.all([
        caltrackDb
          .from('meals')
          .select('*')
          .eq('id', mealId)
          .eq('status', 'confirmed')
          .single(),
        caltrackDb
          .from('meal_items')
          .select('*')
          .eq('meal_id', mealId),
      ]);

      if (!mealRes.data) {
        return NextResponse.json({ error: 'Meal not found' }, { status: 404 });
      }

      return NextResponse.json({
        meal: mealRes.data,
        items: itemsRes.data || [],
      });
    }

    let query = caltrackDb
      .from('meals')
      .select('*', { count: 'exact' })
      .eq('status', 'confirmed')
      .order('eaten_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) {
      query = query.gte('eaten_at', `${from}T00:00:00`);
    }
    if (to) {
      query = query.lte('eaten_at', `${to}T23:59:59`);
    }
    if (mealType) {
      query = query.eq('meal_type', mealType);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    const meals = data || [];
    const mealIds = meals.map((m: { id: string }) => m.id);

    let itemsByMeal: Record<string, string[]> = {};
    if (mealIds.length > 0) {
      const { data: items } = await caltrackDb
        .from('meal_items')
        .select('meal_id,ingredient_name')
        .in('meal_id', mealIds);

      if (items) {
        for (const item of items) {
          if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = [];
          itemsByMeal[item.meal_id].push(item.ingredient_name);
        }
      }
    }

    const enrichedMeals = meals.map((m: { id: string }) => ({
      ...m,
      item_names: itemsByMeal[m.id] || [],
    }));

    // Generate signed URLs for meals that have photos (1 hour TTL)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photoPaths: string[] = enrichedMeals
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m.photo_path)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => m.photo_path as string);

    let signedUrlMap: Record<string, string> = {};
    if (photoPaths.length > 0) {
      const { data: signedUrls } = await caltrackDb.storage
        .from('meals')
        .createSignedUrls(photoPaths, 3600);
      if (signedUrls) {
        for (const item of signedUrls) {
          if (item.signedUrl && item.path) signedUrlMap[item.path as string] = item.signedUrl;
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalMeals = enrichedMeals.map((m: any) => ({
      ...m,
      photo_url: m.photo_path ? (signedUrlMap[m.photo_path] || null) : null,
    }));

    return NextResponse.json({
      meals: finalMeals,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('CalTrack meals error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch meals' },
      { status: 500 }
    );
  }
}
