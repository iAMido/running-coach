export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { garminConnectSchema, validateInput } from '@/lib/validation/schemas';
import { encryptSecret, isEncryptionConfigured } from '@/lib/intervals/crypto';
import { GarminApiError, GarminClient } from '@/lib/garmin/client';
import { getGarminFeedStatus } from '@/lib/db/garmin-wellness';
import { syncGarminWellnessForUser } from '@/lib/garmin/sync';
import { daysBetweenDateStr, userDateStr } from '@/lib/utils/user-time';

/**
 * Garmin Connect Personal API connection.
 *
 * GET    feed status — never returns the key or token
 * POST   save a key: validated with one token exchange, encrypted, then a 14-day sync
 * DELETE disconnect — removes the key only; synced wellness rows are kept
 *        (disarm, not delete — the same rule as Strava)
 *
 * Rotating a key is a POST with the new one: it replaces the row and drops the
 * cached access token minted from the old key.
 */

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await getGarminFeedStatus(auth.userId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      { error: 'INTERVALS_TOKEN_KEY is not configured on the server, so the key cannot be stored securely.' },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const validation = validateInput(garminConnectSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { apiKey, keyExpiresAt } = validation.data;

  const daysLeft = daysBetweenDateStr(userDateStr(), keyExpiresAt);
  if (!Number.isFinite(daysLeft) || daysLeft < 0 || daysLeft > 366) {
    return NextResponse.json(
      { error: 'Expiry must be between today and one year from now (Garmin keys last 30, 90, 180 or 365 days).' },
      { status: 400 },
    );
  }

  // Validate before storing: an unusable key would otherwise surface later as a
  // confusing cron failure.
  let token;
  try {
    token = await new GarminClient({ apiKey }).exchangeToken();
  } catch (error) {
    const message =
      error instanceof GarminApiError
        ? error.status === 401
          ? 'Garmin rejected this key (401). Check it was copied in full, and that it has not been deleted.'
          : error.message
        : `Could not reach Garmin: ${error instanceof Error ? error.message : String(error)}`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from('garmin_tokens').upsert(
    {
      user_id: auth.userId,
      api_key: encryptSecret(apiKey),
      key_expires_at: keyExpiresAt,
      access_token: encryptSecret(token.token),
      access_token_expires_at: token.expiresAt.toISOString(),
      last_error: null,
      cooldown_until: null,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    return NextResponse.json({ error: `Failed to save the key: ${error.message}` }, { status: 500 });
  }

  // First sync straight away, so the page can show data rather than "waiting for the cron".
  const sync = await syncGarminWellnessForUser(auth.userId).catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));

  return NextResponse.json({ success: true, connected: true, sync, status: await getGarminFeedStatus(auth.userId) });
}

export async function DELETE() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { error } = await supabase.from('garmin_tokens').delete().eq('user_id', auth.userId);
  if (error) {
    return NextResponse.json({ error: `Failed to disconnect: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: false });
}
