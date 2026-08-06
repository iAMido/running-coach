export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { intervalsConnectSchema, validateInput } from '@/lib/validation/schemas';
import { encryptSecret, isEncryptionConfigured } from '@/lib/intervals/crypto';
import { IntervalsClient, IntervalsApiError } from '@/lib/intervals/client';
import { userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { IntervalsToken } from '@/lib/db/types';

/**
 * intervals.icu connection management.
 *
 * GET    connection status — never returns the key
 * POST   save credentials (validated against the live API first, then encrypted)
 * DELETE disconnect
 */

/** Status. Deliberately returns no secret material. */
export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data } = await supabase
    .from('intervals_tokens')
    .select('athlete_id,last_sync_at,created_at')
    .eq('user_id', auth.userId)
    .maybeSingle();

  const token = data as Pick<IntervalsToken, 'athlete_id' | 'last_sync_at' | 'created_at'> | null;

  return NextResponse.json({
    connected: Boolean(token),
    athleteId: token?.athlete_id ?? null,
    lastSyncAt: token?.last_sync_at ?? null,
    connectedAt: token?.created_at ?? null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Fail before storing anything rather than writing a row we cannot decrypt.
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      { error: 'INTERVALS_TOKEN_KEY is not configured on the server, so the API key cannot be stored securely.' },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const validation = validateInput(intervalsConnectSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const apiKey = validation.data.apiKey;
  // Absent field and blank field both mean "the athlete this key belongs to".
  const athleteId = validation.data.athleteId ?? '0';

  // Verify the credentials actually work before persisting them. Storing an
  // unusable key would surface later as a confusing cron failure instead of
  // immediate feedback in the UI.
  try {
    const probe = new IntervalsClient({ apiKey, athleteId });
    await probe.getActivities(userDateStrDaysAgo(1), userDateStr());
  } catch (error) {
    const message =
      error instanceof IntervalsApiError
        ? error.message
        : `Could not reach intervals.icu: ${error instanceof Error ? error.message : String(error)}`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from('intervals_tokens').upsert(
    {
      user_id: auth.userId,
      api_key: encryptSecret(apiKey),
      athlete_id: athleteId,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return NextResponse.json({ error: `Failed to save credentials: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, connected: true, athleteId });
}

export async function DELETE() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase.from('intervals_tokens').delete().eq('user_id', auth.userId);
  if (error) {
    return NextResponse.json({ error: `Failed to disconnect: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, connected: false });
}
