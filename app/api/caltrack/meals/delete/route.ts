import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
import { israelDateFromIso } from '@/lib/db/caltrack-date';

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
    const { meal_id } = body as { meal_id: string };

    if (!meal_id) {
      return NextResponse.json({ error: 'Missing meal_id' }, { status: 400 });
    }

    const { data: meal } = await caltrackDb
      .from('meals')
      .select('*')
      .eq('id', meal_id)
      .single();

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 });
    }

    // Delete ai_corrections referencing this meal's items
    const { data: itemIds } = await caltrackDb
      .from('meal_items')
      .select('id')
      .eq('meal_id', meal_id);

    if (itemIds && itemIds.length > 0) {
      await caltrackDb
        .from('ai_corrections')
        .delete()
        .in(
          'meal_item_id',
          itemIds.map((r: { id: string }) => r.id)
        );
    }

    await caltrackDb.from('meal_items').delete().eq('meal_id', meal_id);
    const { error: deleteError } = await caltrackDb
      .from('meals')
      .delete()
      .eq('id', meal_id);

    if (deleteError) throw deleteError;

    // Refresh daily summary — Israel local date so we update the day the
    // deleted meal actually belonged to.
    const summaryDate = israelDateFromIso(meal.eaten_at);
    const profileRes = await caltrackDb
      .from('user_profile')
      .select('id,target_daily_calories')
      .limit(1)
      .single();

    if (profileRes.data) {
      const { data: dayMeals } = await caltrackDb
        .from('meals')
        .select(
          'total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,eaten_at'
        )
        .eq('user_id', profileRes.data.id)
        .eq('status', 'confirmed');

      const sameDay = (dayMeals || []).filter(
        (m: { eaten_at: string }) => israelDateFromIso(m.eaten_at) === summaryDate
      );
      const dayTotals = sameDay.reduce(
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
          user_id: profileRes.data.id,
          date: summaryDate,
          total_calories_in: dayTotals.cal,
          total_protein_g: Math.round(dayTotals.pro * 10) / 10,
          total_carbs_g: Math.round(dayTotals.carb * 10) / 10,
          total_fat_g: Math.round(dayTotals.fat * 10) / 10,
          total_fiber_g: Math.round(dayTotals.fib * 10) / 10,
          target_calories: profileRes.data.target_daily_calories || 2000,
          meal_count: sameDay.length,
        },
        { onConflict: 'user_id,date' }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    const msg =
      err?.message || err?.details || err?.hint || JSON.stringify(error);
    console.error('CalTrack delete meal error:', msg, error);
    return NextResponse.json(
      { error: `Failed to delete meal: ${msg}` },
      { status: 500 }
    );
  }
}
