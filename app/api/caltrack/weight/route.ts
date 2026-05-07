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

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString();

  try {
    const { data, error } = await caltrackDb
      .from('weight_log')
      .select('weight_kg,measured_at')
      .gte('measured_at', startStr)
      .order('measured_at', { ascending: true });

    if (error) throw error;

    const weights = (data || []).map(
      (w: { measured_at: string; weight_kg: number }) => ({
        date: w.measured_at.split('T')[0],
        weight: w.weight_kg,
      })
    );

    const profileRes = await caltrackDb
      .from('user_profile')
      .select('current_weight_kg,target_weight_kg')
      .limit(1)
      .single();

    return NextResponse.json({
      weights,
      currentWeight: profileRes.data?.current_weight_kg,
      targetWeight: profileRes.data?.target_weight_kg,
    });
  } catch (error) {
    console.error('CalTrack weight error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weight data' },
      { status: 500 }
    );
  }
}
