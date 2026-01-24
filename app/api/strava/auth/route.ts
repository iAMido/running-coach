import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { generateOAuthState } from '@/lib/utils/oauth-state';

export async function GET() {
  const session = await getServerSession();

  // Require authentication - no dev bypass for OAuth initiation
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized - please sign in first' }, { status: 401 });
  }

  const userEmail = session.user.email;

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
