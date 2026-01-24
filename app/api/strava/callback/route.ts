import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { verifyOAuthState } from '@/lib/utils/oauth-state';

// Handle GET request from Strava OAuth redirect
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/coach/strava?error=' + encodeURIComponent(error), request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/coach/strava?error=missing_params', request.url));
  }

  // Verify the signed state to prevent CSRF attacks
  const stateVerification = verifyOAuthState(state);
  if (!stateVerification.valid) {
    console.error('OAuth state verification failed:', stateVerification.error);
    return NextResponse.redirect(new URL('/coach/strava?error=invalid_state', request.url));
  }

  const userId = stateVerification.userId;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/coach/strava?error=not_configured', request.url));
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return NextResponse.redirect(new URL('/coach/strava?error=token_exchange', request.url));
    }

    const tokens = await tokenResponse.json();

    // Save tokens to database
    const { error: dbError } = await supabase
      .from('strava_tokens')
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        athlete_id: tokens.athlete?.id?.toString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.redirect(new URL('/coach/strava?error=db_error', request.url));
    }

    // Success - redirect back to Strava page
    return NextResponse.redirect(new URL('/coach/strava?success=true', request.url));
  } catch (err) {
    console.error('Error in Strava callback:', err);
    return NextResponse.redirect(new URL('/coach/strava?error=unknown', request.url));
  }
}
