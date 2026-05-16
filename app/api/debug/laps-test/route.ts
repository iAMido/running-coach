import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { formatPace } from '@/lib/utils/pace';

interface StravaLap {
  lap_index: number;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}

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
        return NextResponse.json({ error: 'Token refresh failed' });
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

    // Get all strava runs without laps
    const { data: runs } = await supabase
      .from('runs')
      .select('id, filename')
      .eq('user_id', userId)
      .like('filename', 'strava_%')
      .order('date', { ascending: false });

    if (!runs || runs.length === 0) {
      return NextResponse.json({ message: 'No strava runs found' });
    }

    const results: { activityId: string; status: string; laps?: number; error?: string }[] = [];

    for (const run of runs) {
      const { count } = await supabase
        .from('laps')
        .select('*', { count: 'exact', head: true })
        .eq('run_id', run.id);

      if (count && count > 0) {
        results.push({ activityId: run.filename.replace('strava_', ''), status: 'already_has_laps', laps: count });
        continue;
      }

      const activityId = run.filename.replace('strava_', '');

      try {
        const lapsResponse = await fetch(
          `https://www.strava.com/api/v3/activities/${activityId}/laps`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!lapsResponse.ok) {
          results.push({ activityId, status: 'strava_error', error: `HTTP ${lapsResponse.status}` });
          continue;
        }

        const lapsData = await lapsResponse.json();
        if (!Array.isArray(lapsData) || lapsData.length === 0) {
          results.push({ activityId, status: 'no_laps_from_strava' });
          continue;
        }

        const lapsToInsert = lapsData.map((lap: StravaLap) => ({
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

        const { error: insertError } = await supabase.from('laps').insert(lapsToInsert);

        if (insertError) {
          results.push({ activityId, status: 'insert_error', error: insertError.message });
        } else {
          results.push({ activityId, status: 'backfilled', laps: lapsToInsert.length });
        }
      } catch (err) {
        results.push({ activityId, status: 'error', error: String(err) });
      }
    }

    const backfilled = results.filter(r => r.status === 'backfilled').length;
    const alreadyHad = results.filter(r => r.status === 'already_has_laps').length;
    const failed = results.filter(r => r.status === 'insert_error' || r.status === 'strava_error' || r.status === 'error').length;

    return NextResponse.json({
      summary: { total: runs.length, backfilled, alreadyHad, failed },
      details: results,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
