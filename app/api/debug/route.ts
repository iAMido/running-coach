import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase, isSupabaseConfigured } from '@/lib/db/supabase';

export async function GET() {
  // Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Debug endpoint disabled in production' }, { status: 403 });
  }

  // Require authentication even in development
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const userId = session.user.email;

  // Only show limited, non-sensitive debug info
  let supabaseStatus = 'unknown';
  let runCount = 0;
  let stravaConnected = false;

  try {
    if (isSupabaseConfigured()) {
      const { count, error } = await supabase
        .from('runs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) {
        supabaseStatus = 'error';
      } else {
        supabaseStatus = 'connected';
        runCount = count || 0;
      }

      const { data: stravaData } = await supabase
        .from('strava_tokens')
        .select('athlete_id')
        .eq('user_id', userId)
        .single();

      stravaConnected = !!stravaData;
    } else {
      supabaseStatus = 'not_configured';
    }
  } catch {
    supabaseStatus = 'exception';
  }

  // Return only boolean flags for configuration (no values or URIs)
  return NextResponse.json({
    environment: process.env.NODE_ENV,
    user: session.user.email,
    configured: {
      googleOAuth: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      nextAuth: !!process.env.NEXTAUTH_SECRET,
      supabase: isSupabaseConfigured(),
      strava: !!process.env.STRAVA_CLIENT_ID && !!process.env.STRAVA_CLIENT_SECRET,
    },
    supabaseStatus,
    runCount,
    stravaConnected,
  });
}
