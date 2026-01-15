import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET() {
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userEmail = session?.user?.email || DEV_USER_ID;

  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  const scope = 'read,activity:read_all';
  const state = userEmail; // Use email as state for simplicity

  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
