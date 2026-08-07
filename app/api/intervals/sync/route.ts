export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { intervalsSyncSchema, validateInput } from '@/lib/validation/schemas';
import {
  claimAutoSync,
  getIntervalsClientForUser,
  releaseAutoSyncClaim,
  syncIntervalsForUser,
  type SyncClaim,
} from '@/lib/intervals/sync';
import { IntervalsApiError } from '@/lib/intervals/client';

/**
 * Manual "Sync Now", and — when `ifStaleMinutes` is passed — the automatic
 * sync-on-open.
 *
 * Response shape mirrors the Strava sync route so the Phase 6 page is a
 * straight port — plus `dateCorrected`, which matters during cutover.
 *
 * The automatic path never returns an error status for the ordinary outcomes.
 * It fires unprompted in the background, so "already fresh" and "not connected"
 * are normal results, not failures worth a red line in anyone's console.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    const body = await request.json().catch(() => ({}));

    const validation = validateInput(intervalsSyncSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { daysBack, ifStaleMinutes } = validation.data;
    const isAutomatic = ifStaleMinutes !== undefined;

    // Claim BEFORE decrypting credentials: two tabs racing should cost one
    // cheap database round trip, not two intervals.icu sessions.
    let claim: SyncClaim | null = null;
    if (isAutomatic) {
      claim = await claimAutoSync(userId, ifStaleMinutes);
      if (!claim.claimed) {
        return NextResponse.json({ success: true, skipped: true, reason: claim.reason, lastSyncAt: claim.previous });
      }
    }

    const connection = await getIntervalsClientForUser(userId);
    if (!connection) {
      if (claim) await releaseAutoSyncClaim(userId, claim);
      if (isAutomatic) {
        return NextResponse.json({ success: true, skipped: true, reason: 'not_connected' });
      }
      return NextResponse.json({ error: 'intervals.icu not connected' }, { status: 400 });
    }

    let result;
    try {
      result = await syncIntervalsForUser(userId, connection.client, { daysBack });
    } catch (err) {
      // A failed sync must not leave a timestamp claiming it succeeded, which
      // would also suppress the next automatic attempt for the whole window.
      if (claim) await releaseAutoSyncClaim(userId, claim);
      throw err;
    }

    return NextResponse.json({
      success: true,
      skipped: false,
      newRunsCount: result.newRunsCount,
      lapsBackfilledCount: result.lapsBackfilledCount,
      wellnessDaysUpserted: result.wellnessDaysUpserted,
      dateCorrected: result.dateCorrected,
      errors: result.errors,
    });
  } catch (error) {
    // The client's messages already name the real cause (a 403 is the
    // User-Agent, not authorization), so surface them rather than flattening
    // everything to "Failed to sync".
    if (error instanceof IntervalsApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('Error syncing intervals.icu:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
