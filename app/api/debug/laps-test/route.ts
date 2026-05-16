import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    // Allow temporarily for diagnosis, remove after
  }

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

    // Fetch laps from Strava
    const lapsUrl = `https://www.strava.com/api/v3/activities/${activityId}/laps`;
    const lapsResponse = await fetch(lapsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lapsStatus = lapsResponse.status;
    const lapsBody = await lapsResponse.json();

    return NextResponse.json({
      runId: run.id,
      activityId,
      lapsUrl,
      lapsStatus,
      lapsCount: Array.isArray(lapsBody) ? lapsBody.length : 'not-array',
      firstLap: Array.isArray(lapsBody) && lapsBody.length > 0 ? lapsBody[0] : null,
      rawResponse: Array.isArray(lapsBody) ? undefined : lapsBody,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
