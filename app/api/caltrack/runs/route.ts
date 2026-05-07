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
  const days = Math.min(parseInt(searchParams.get('days') || '30'), 365);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString();

  try {
    const { data, error } = await caltrackDb
      .from('caltrack_runs')
      .select('*')
      .gte('run_date', startStr)
      .order('run_date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const runs = data || [];
    const totalDistance = runs.reduce(
      (sum: number, r: { distance_km: number }) => sum + (r.distance_km || 0),
      0
    );
    const totalCalories = runs.reduce(
      (sum: number, r: { calories_burned: number }) =>
        sum + (r.calories_burned || 0),
      0
    );
    const totalDuration = runs.reduce(
      (sum: number, r: { duration_minutes: number }) =>
        sum + (r.duration_minutes || 0),
      0
    );

    return NextResponse.json({
      runs,
      stats: {
        totalRuns: runs.length,
        totalDistance: Math.round(totalDistance * 10) / 10,
        totalCalories,
        totalDuration,
      },
    });
  } catch (error) {
    console.error('CalTrack runs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch runs' },
      { status: 500 }
    );
  }
}
