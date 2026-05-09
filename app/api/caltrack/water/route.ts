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
  const dateParam = searchParams.get('date');

  // Use Israel timezone
  const nowIsrael = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })
  );
  const dateStr = dateParam || nowIsrael.toISOString().split('T')[0];

  try {
    // Get today's water logs
    const { data: logs, error } = await caltrackDb
      .from('water_log')
      .select('id,amount_ml,logged_at')
      .gte('logged_at', `${dateStr}T00:00:00`)
      .lte('logged_at', `${dateStr}T23:59:59`)
      .order('logged_at', { ascending: true });

    if (error) throw error;

    const totalMl = (logs || []).reduce(
      (sum: number, l: { amount_ml: number }) => sum + l.amount_ml,
      0
    );

    return NextResponse.json({
      date: dateStr,
      total_ml: totalMl,
      target_ml: 2500,
      logs: logs || [],
    });
  } catch (error) {
    console.error('CalTrack water error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch water data' },
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
    const amount_ml = parseInt(body.amount_ml);

    if (!amount_ml || amount_ml <= 0 || amount_ml > 5000) {
      return NextResponse.json(
        { error: 'Invalid amount. Must be 1-5000 ml.' },
        { status: 400 }
      );
    }

    // Get user profile for user_id
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

    const { data, error } = await caltrackDb
      .from('water_log')
      .insert({
        user_id: profile.id,
        amount_ml,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, entry: data });
  } catch (error) {
    console.error('CalTrack water POST error:', error);
    return NextResponse.json(
      { error: 'Failed to log water' },
      { status: 500 }
    );
  }
}
