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
        return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 });
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

    for (const activity of runs) {
      const filename = `strava_${activity.id}`;
      console.log(`Checking activity ${filename} (${activity.name})`);

      // Check if already exists
      const { data: existing, error: checkError } = await supabase
        .from('runs')
        .select('id')
        .eq('user_id', userId)
        .eq('filename', filename)
        .single();

      console.log(`  Existing: ${!!existing}, Error: ${checkError?.code || 'none'}`);

      if (existing) {
        console.log(`  Skipping - already exists`);
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
      }
    }

    return NextResponse.json({ success: true, newRunsCount });
  } catch (error) {
    console.error('Error syncing Strava:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}
