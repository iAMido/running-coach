import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { generateOAuthState } from '@/lib/utils/oauth-state';

export async function GET() {
  const auth = await getAuthenticatedUser();

  // Require authentication - no dev bypass for OAuth initiation
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized - please sign in first' }, { status: 401 });
  }

  const userEmail = auth.userId;

  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  const scope = 'read,activity:read_all';
  // Use cryptographically signed state to prevent CSRF
  const state = generateOAuthState(userEmail);

  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
