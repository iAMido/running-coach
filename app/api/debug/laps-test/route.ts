import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { formatPace } from '@/lib/utils/pace';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  try {
    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'No Strava token', tokenError });
    }

    // Refresh if needed
    let accessToken = tokenData.access_token;
    const expiresAt = new Date(tokenData.expires_at);

    if (expiresAt < new Date()) {
      const refreshResponse = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenData.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!refreshResponse.ok) {
        const refreshBody = await refreshResponse.text();
        return NextResponse.json({ error: 'Token refresh failed', status: refreshResponse.status, body: refreshBody });
      }

      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;

      await supabase
        .from('strava_tokens')
        .update({
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_at: new Date(newTokens.expires_at * 1000).toISOString(),
        })
        .eq('user_id', userId);
    }

    // Get one run
    const { data: run } = await supabase
      .from('runs')
      .select('id, filename')
      .eq('user_id', userId)
      .like('filename', 'strava_%')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'No strava runs found' });
    }

    const activityId = run.filename.replace('strava_', '');

    // Check existing laps count
    const { count: existingLapCount, error: countError } = await supabase
      .from('laps')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run.id);

    // Fetch laps from Strava
    const lapsUrl = `https://www.strava.com/api/v3/activities/${activityId}/laps`;
    const lapsResponse = await fetch(lapsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lapsStatus = lapsResponse.status;
    const lapsBody = await lapsResponse.json();

    // Try to insert laps
    let insertResult = null;
    if (Array.isArray(lapsBody) && lapsBody.length > 0) {
      const lapsToInsert = lapsBody.map((lap: { lap_index: number; distance: number; moving_time: number; average_heartrate?: number; max_heartrate?: number; average_speed: number }) => ({
        run_id: run.id,
        lap_number: lap.lap_index,
        distance_km: Math.round((lap.distance / 1000) * 1000) / 1000,
        duration_sec: Math.round(lap.moving_time),
        avg_hr: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
        max_hr: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
        avg_pace_str: lap.average_speed > 0
          ? formatPace(1 / (lap.average_speed * 60 / 1000))
          : null,
      }));

      // First delete any existing laps for this run to avoid unique constraint issues
      const { error: deleteError } = await supabase
        .from('laps')
        .delete()
        .eq('run_id', run.id);

      const { data: insertData, error: insertError } = await supabase
        .from('laps')
        .insert(lapsToInsert)
        .select();

      insertResult = {
        deleteError: deleteError ? deleteError.message : null,
        insertError: insertError ? { message: insertError.message, details: insertError.details, hint: insertError.hint, code: insertError.code } : null,
        insertedCount: insertData ? insertData.length : 0,
        firstInserted: insertData && insertData.length > 0 ? insertData[0] : null,
        samplePayload: lapsToInsert[0],
      };
    }

    return NextResponse.json({
      runId: run.id,
      activityId,
      existingLapCount,
      countError: countError ? countError.message : null,
      lapsStatus,
      lapsCount: Array.isArray(lapsBody) ? lapsBody.length : 'not-array',
      insertResult,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
