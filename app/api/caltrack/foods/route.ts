import { NextResponse } from 'next/server';
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
    const { data, error } = await caltrackDb
      .from('meal_items')
      .select('ingredient_name,weight_grams,calories');

    if (error) throw error;

    const agg: Record<
      string,
      { count: number; totalCal: number; totalWeight: number }
    > = {};

    for (const item of data || []) {
      const name = item.ingredient_name;
      if (!agg[name]) {
        agg[name] = { count: 0, totalCal: 0, totalWeight: 0 };
      }
      agg[name].count++;
      agg[name].totalCal += item.calories || 0;
      agg[name].totalWeight += item.weight_grams || 0;
    }

    const foods = Object.entries(agg)
      .map(([name, stats]) => ({
        ingredient_name: name,
        total_count: stats.count,
        avg_calories: Math.round(stats.totalCal / stats.count),
        avg_weight: Math.round(stats.totalWeight / stats.count),
      }))
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
