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
  const q = searchParams.get('q');

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const { data, error } = await caltrackDb
      .from('usda_foundation')
      .select('fdc_id,description,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g')
      .ilike('description', `%${q}%`)
      .limit(10);

    if (error) throw error;

    return NextResponse.json({
      results: (data || []).map((f) => ({
        fdc_id: f.fdc_id,
        name: f.description,
        per100g: {
          calories: f.calories_per_100g || 0,
          protein: f.protein_per_100g || 0,
          carbs: f.carbs_per_100g || 0,
          fat: f.fat_per_100g || 0,
          fiber: f.fiber_per_100g || 0,
        },
      })),
    });
  } catch (error) {
    console.error('CalTrack food search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
