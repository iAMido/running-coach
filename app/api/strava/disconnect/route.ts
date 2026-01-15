import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';

const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET() {
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

  try {
    const { data, error } = await supabase
      .from('strava_tokens')
      .select('athlete_id, created_at')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return NextResponse.json({ connected: !!data, athleteId: data?.athlete_id });
  } catch (error) {
    console.error('Error checking Strava status:', error);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}

export async function POST() {
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

  try {
    const { error } = await supabase
      .from('strava_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Strava:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
