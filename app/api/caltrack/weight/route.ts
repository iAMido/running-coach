import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

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
    const weight_kg = parseFloat(body.weight_kg);

    if (!weight_kg || weight_kg < 20 || weight_kg > 300) {
      return NextResponse.json(
        { error: 'Invalid weight. Must be 20-300 kg.' },
        { status: 400 }
      );
    }

    // Get user profile
    const { data: profile } = await caltrackDb
      .from('user_profile')
      .select('id')
      .limit(1)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      );
    }

    // Insert weight log
    const { data, error } = await caltrackDb
      .from('weight_log')
      .insert({
        user_id: profile.id,
        weight_kg,
      })
      .select()
      .single();

    if (error) throw error;

    // Update current weight in profile
    await caltrackDb
      .from('user_profile')
      .update({ current_weight_kg: weight_kg })
      .eq('id', profile.id);

    return NextResponse.json({ success: true, entry: data });
  } catch (error) {
    console.error('CalTrack weight POST error:', error);
    return NextResponse.json(
      { error: 'Failed to log weight' },
      { status: 500 }
    );
  }
}

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
  const days = Math.min(parseInt(searchParams.get('days') || '30'), 365);

  let startStr: string;
  let endStr: string | undefined;

  if (fromParam && toParam) {
    startStr = `${fromParam}T00:00:00`;
    endStr = `${toParam}T23:59:59`;
  } else {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startStr = startDate.toISOString();
  }

  try {
    let query = caltrackDb
      .from('weight_log')
      .select('weight_kg,measured_at')
      .gte('measured_at', startStr)
      .order('measured_at', { ascending: true });

    if (endStr) {
      query = query.lte('measured_at', endStr);
    }

    const { data, error } = await query;

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
