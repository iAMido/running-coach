export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { upsertRun, once } from '@/lib/ingest/upsert-run';
import { filterRuns, toNormalizedRun } from '@/lib/ingest/strava';

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

      // Per-user classifier inputs: HR zones + workout-name aware run-typing.
      const profile = await getAthleteProfile(userId);
      const zoneBands = parseZonesFromProfile(profile);
      // Fetched at most once per user, and only if a run is actually imported.
      // Used for the morning-after coach note's planned-vs-actual judgement.
      const activePlan = once(() => getActivePlan(userId));

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

      const runs = filterRuns(await activitiesResponse.json());

      let newCount = 0;
      let lapsBackfilled = 0;

      for (const activity of runs) {
        try {
          const result = await upsertRun(userId, toNormalizedRun(activity, accessToken), {
            profile,
            zoneBands,
            activePlan,
          });

          if (result.created) newCount++;
          else if (result.lapsWritten > 0) lapsBackfilled++;
        } catch {
          // One bad activity must not abort the rest of the user's sync.
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
