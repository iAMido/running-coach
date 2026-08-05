export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { stravaSyncSchema, validateInput } from '@/lib/validation/schemas';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { parseZonesFromProfile, type ZoneBands } from '@/lib/utils/zones';
import { upsertRun, once } from '@/lib/ingest/upsert-run';
import { filterRuns, toNormalizedRun } from '@/lib/ingest/strava';
import type { AthleteProfile } from '@/lib/db/types';

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
      // Surface Strava's actual error body — a 403 with
      // {"resource":"Application","field":"Status","code":"Inactive"} means
      // the Strava API app itself was deactivated (re-accept API terms at
      // strava.com/settings/api), which no amount of token refreshing fixes.
      const errBody = await activitiesResponse.text().catch(() => '');
      const inactive = errBody.includes('"Inactive"');
      return NextResponse.json({
        error: inactive
          ? 'Strava has deactivated the API application. Go to strava.com/settings/api and reactivate it (usually re-accepting the API agreement).'
          : `Strava API error ${activitiesResponse.status}: ${errBody.slice(0, 300)}`,
      }, { status: 502 });
    }

    const activities = await activitiesResponse.json();
    const runs = filterRuns(activities);

    console.log(`Strava returned ${Array.isArray(activities) ? activities.length : 0} activities, ${runs.length} runs`);

    // Pull athlete profile once so the classifier + zone bands use the user's
    // actual HR zones rather than hardcoded defaults.
    const profile: AthleteProfile | null = await getAthleteProfile(userId);
    const zoneBands: ZoneBands = parseZonesFromProfile(profile);
    // Fetched at most once, and only if a run is actually imported.
    const activePlan = once(() => getActivePlan(userId));

    let newRunsCount = 0;
    let lapsBackfilledCount = 0;

    for (const activity of runs) {
      try {
        const result = await upsertRun(userId, toNormalizedRun(activity, accessToken), {
          profile,
          zoneBands,
          activePlan,
        });

        if (result.created) newRunsCount++;
        else if (result.lapsWritten > 0) lapsBackfilledCount++;
      } catch (runError) {
        // One bad activity must not abort the whole sync.
        console.log(`  Failed to ingest strava_${activity.id}: ${runError}`);
      }
    }

    return NextResponse.json({ success: true, newRunsCount, lapsBackfilledCount });
  } catch (error) {
    console.error('Error syncing Strava:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}
