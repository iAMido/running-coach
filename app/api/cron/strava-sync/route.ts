export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { classifyRun } from '@/lib/utils/run-classifier';
import { calculateTrimp } from '@/lib/utils/trimp';
import { formatPace, calculatePace } from '@/lib/utils/pace';

interface StravaLap {
  lap_index: number;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  try {
    // Get all users with Strava tokens
    const { data: tokens } = await supabase
      .from('strava_tokens')
      .select('*');

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ message: 'No Strava tokens found' });
    }

    const results = [];

    for (const tokenData of tokens) {
      const userId = tokenData.user_id;
      let accessToken = tokenData.access_token;

      // Refresh if needed
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
          results.push({ userId, error: 'Token refresh failed' });
          continue;
        }

        const newTokens = await refreshResponse.json();
        accessToken = newTokens.access_token;

        await supabase
          .from('strava_tokens')
          .update({
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token,
            expires_at: new Date(newTokens.expires_at * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      }

      // Fetch last 2 days of activities
      const after = Math.floor(Date.now() / 1000) - (2 * 24 * 60 * 60);
      const activitiesResponse = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=30`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!activitiesResponse.ok) {
        results.push({ userId, error: 'Failed to fetch activities' });
        continue;
      }

      const activities = await activitiesResponse.json();
      const runs = activities.filter(
        (a: { type: string }) => a.type === 'Run' || a.type === 'VirtualRun'
      );

      let newCount = 0;
      let lapsBackfilled = 0;

      for (const activity of runs) {
        const filename = `strava_${activity.id}`;

        const { data: existing } = await supabase
          .from('runs')
          .select('id')
          .eq('user_id', userId)
          .eq('filename', filename)
          .single();

        if (existing) {
          // Backfill laps if missing
          const { count } = await supabase
            .from('laps')
            .select('*', { count: 'exact', head: true })
            .eq('run_id', existing.id);

          if (!count) {
            try {
              const lapsResponse = await fetch(
                `https://www.strava.com/api/v3/activities/${activity.id}/laps`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (lapsResponse.ok) {
                const lapsData = await lapsResponse.json();
                if (Array.isArray(lapsData) && lapsData.length > 0) {
                  const lapsToInsert = lapsData.map((lap: StravaLap) => ({
                    run_id: existing.id,
                    lap_number: lap.lap_index,
                    distance_km: Math.round((lap.distance / 1000) * 1000) / 1000,
                    duration_sec: Math.round(lap.moving_time),
                    avg_hr: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
                    max_hr: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
                    avg_pace_str: lap.average_speed > 0
                      ? formatPace(1 / (lap.average_speed * 60 / 1000))
                      : null,
                  }));
                  const { error } = await supabase.from('laps').insert(lapsToInsert);
                  if (!error) lapsBackfilled++;
                }
              }
            } catch { /* best effort */ }
          }
          continue;
        }

        // New run
        const distanceKm = activity.distance / 1000;
        const durationMin = activity.moving_time / 60;
        const avgHr = activity.average_heartrate ? Math.round(activity.average_heartrate) : null;
        const maxHr = activity.max_heartrate ? Math.round(activity.max_heartrate) : null;
        const avgPaceMinKm = calculatePace(distanceKm, durationMin);

        const runType = classifyRun({
          distanceKm,
          avgHr: avgHr ?? undefined,
          maxHr: maxHr ?? undefined,
          durationMin,
        });

        const trimp = avgHr ? calculateTrimp({ durationMin, avgHr }) : null;

        const { error: insertError, data: insertedRun } = await supabase
          .from('runs')
          .insert({
            user_id: userId,
            filename,
            date: activity.start_date,
            distance_km: Math.round(distanceKm * 100) / 100,
            duration_min: Math.round(durationMin * 100) / 100,
            avg_hr: avgHr,
            max_hr: maxHr,
            avg_pace_min_km: avgPaceMinKm,
            avg_pace_str: formatPace(avgPaceMinKm),
            calories: activity.calories || null,
            run_type: runType,
            workout_name: activity.name,
            trimp,
            data_source: 'strava_sync',
          })
          .select('id')
          .single();

        if (!insertError && insertedRun) {
          newCount++;

          // Fetch laps
          try {
            const lapsResponse = await fetch(
              `https://www.strava.com/api/v3/activities/${activity.id}/laps`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (lapsResponse.ok) {
              const lapsData = await lapsResponse.json();
              if (Array.isArray(lapsData) && lapsData.length > 0) {
                const lapsToInsert = lapsData.map((lap: StravaLap) => ({
                  run_id: insertedRun.id,
                  lap_number: lap.lap_index,
                  distance_km: Math.round((lap.distance / 1000) * 1000) / 1000,
                  duration_sec: Math.round(lap.moving_time),
                  avg_hr: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
                  max_hr: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
                  avg_pace_str: lap.average_speed > 0
                    ? formatPace(1 / (lap.average_speed * 60 / 1000))
                    : null,
                }));
                await supabase.from('laps').insert(lapsToInsert);
              }
            }
          } catch { /* best effort */ }
        }
      }

      results.push({ userId, newRuns: newCount, lapsBackfilled });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Cron strava sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
