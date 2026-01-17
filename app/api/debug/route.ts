import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET() {
  // Test Supabase connection
  let supabaseStatus = 'unknown';
  let runCount = 0;
  let stravaConnected = false;

  try {
    const { count, error } = await supabase
      .from('runs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'idomosseri@gmail.com');

    if (error) {
      supabaseStatus = `error: ${error.message}`;
    } else {
      supabaseStatus = 'connected';
      runCount = count || 0;
    }

    const { data: stravaData } = await supabase
      .from('strava_tokens')
      .select('athlete_id')
      .eq('user_id', 'idomosseri@gmail.com')
      .single();

    stravaConnected = !!stravaData;
  } catch (e) {
    supabaseStatus = `exception: ${e}`;
  }

  return NextResponse.json({
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
    hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasStravaClientId: !!process.env.STRAVA_CLIENT_ID,
    hasStravaClientSecret: !!process.env.STRAVA_CLIENT_SECRET,
    hasStravaRedirectUri: !!process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URI,
    stravaRedirectUri: process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URI,
    supabaseStatus,
    runCount,
    stravaConnected,
  });
}
