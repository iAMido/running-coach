import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isCaltrackConfigured()) {
    return NextResponse.json({ error: 'CalTrack database not configured' }, { status: 503 });
  }

  try {
    const { data: profile } = await caltrackDb
      .from('user_profile')
      .select('id')
      .limit(1)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'No user profile found' }, { status: 404 });
    }

    const { data: reports, error } = await caltrackDb
      .from('coach_reports')
      .select('*')
      .eq('user_id', profile.id)
      .order('week_start', { ascending: false })
      .limit(52); // up to 1 year of reports

    if (error) throw error;

    return NextResponse.json({ reports: reports || [] });
  } catch (error) {
    console.error('Coach reports fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch coach reports' }, { status: 500 });
  }
}
