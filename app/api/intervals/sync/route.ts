export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { intervalsSyncSchema, validateInput } from '@/lib/validation/schemas';
import { getIntervalsClientForUser, syncIntervalsForUser } from '@/lib/intervals/sync';
import { IntervalsApiError } from '@/lib/intervals/client';

/**
 * Manual "Sync Now".
 *
 * Response shape mirrors the Strava sync route so the Phase 6 page is a
 * straight port — plus `dateCorrected`, which matters during cutover.
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

    const connection = await getIntervalsClientForUser(userId);
    if (!connection) {
      return NextResponse.json({ error: 'intervals.icu not connected' }, { status: 400 });
    }

    const result = await syncIntervalsForUser(userId, connection.client, {
      daysBack: validation.data.daysBack,
    });

    return NextResponse.json({
      success: true,
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
