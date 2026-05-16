export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { classifyRun } from '@/lib/utils/run-classifier';
import { calculateTrimp } from '@/lib/utils/trimp';
import { formatPace, calculatePace } from '@/lib/utils/pace';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { stravaSyncSchema, validateInput } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate input
    const validation = validateInput(stravaSyncSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { daysBack = 7 } = validation.data;

    // Get stored tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Strava not connected' }, { status: 400 });
    }

    // Check if token needs refresh
    let accessToken = tokenData.access_token;
    const expiresAt = new Date(tokenData.expires_at);

    if (expiresAt < new Date()) {
      // Refresh token
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
        const errorBody = await refreshResponse.text().catch(() => '');
        if (refreshResponse.status === 401) {
          await supabase.from('strava_tokens').delete().eq('user_id', userId);
          return NextResponse.json({ error: 'Strava authorization expired. Please reconnect.' }, { status: 401 });
        }
        return NextResponse.json({ error: `Failed to refresh token (${refreshResponse.status}): ${errorBody}` }, { status: 500 });
      }

      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;

      // Update stored tokens
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

    // Fetch activities
    const after = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);
    const activitiesResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!activitiesResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
    }

    const activities = await activitiesResponse.json();

    console.log('Strava returned activities:', activities.length);
    console.log('Activity types:', activities.map((a: { type: string; name: string; start_date: string }) =>
      `${a.type}: ${a.name} (${a.start_date})`
    ));

    // Filter for runs only
    const runs = activities.filter(
      (a: { type: string }) => a.type === 'Run' || a.type === 'VirtualRun'
    );

    console.log('Filtered runs:', runs.length);

    let newRunsCount = 0;
    let lapsBackfilledCount = 0;

    for (const activity of runs) {
      const filename = `strava_${activity.id}`;

      // Check if already exists
      const { data: existing } = await supabase
        .from('runs')
        .select('id')
        .eq('user_id', userId)
        .eq('filename', filename)
        .single();

      if (existing) {
        // Backfill laps if this run has none yet
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
                const { error: insertError } = await supabase.from('laps').insert(lapsToInsert);
                if (!insertError) {
                  lapsBackfilledCount++;
                }
              }
            }
          } catch {
            // Lap backfill is best-effort
          }
        }
        continue;
      }

      // Process the run
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

      const trimp = avgHr
        ? calculateTrimp({ durationMin, avgHr })
        : null;

      // Insert run
      const { error: insertError } = await supabase
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
        });

      if (insertError) {
        console.log(`  Insert error: ${insertError.message}`);
      } else {
        console.log(`  Inserted successfully!`);
        newRunsCount++;

        // Fetch and save laps for this activity
        const { data: insertedRun } = await supabase
          .from('runs')
          .select('id')
          .eq('user_id', userId)
          .eq('filename', filename)
          .single();

        if (insertedRun) {
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
                console.log(`  Saved ${lapsToInsert.length} laps`);
              }
            }
          } catch (lapErr) {
            console.log(`  Failed to fetch laps: ${lapErr}`);
          }
        }
      }
    }

    return NextResponse.json({ success: true, newRunsCount, lapsBackfilledCount });
  } catch (error) {
    console.error('Error syncing Strava:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

interface StravaLap {
  lap_index: number;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}
