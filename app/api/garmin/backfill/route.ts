export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { garminBackfillSchema, validateInput } from '@/lib/validation/schemas';
import { BODY_BATTERY_MAX_DAYS } from '@/lib/garmin/client';
import { syncGarminWellnessForUser } from '@/lib/garmin/sync';
import { daysBetweenDateStr, userDateStr } from '@/lib/utils/user-time';

/** Sleep is one call per night; a history import spaces them wider than the cron does. */
const IMPORT_SLEEP_SPACING_MS = 1000;

/**
 * Import ONE window of Garmin history (≤ 28 days). The connect card loops it
 * oldest-first, so a year is ~13 requests of ~35 s each (sleep costs one call
 * per night, spaced 1 s apart) — each well inside the function timeout, and a
 * stop part-way keeps everything already imported. When Garmin rate-limits,
 * the result carries `cooldownUntil` and the card waits and retries the window.
 *
 * Same code path as the cron (`syncGarminWellnessForUser`), so a backfilled
 * day is indistinguishable from a synced one. The CLI equivalent is
 * `scripts/backfill-garmin-wellness.ts`, which needs the app's secrets locally.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const validation = validateInput(garminBackfillSchema, await request.json().catch(() => ({})));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { from, to } = validation.data;

  const span = daysBetweenDateStr(from, to) + 1;
  if (!Number.isFinite(span) || span < 1 || span > BODY_BATTERY_MAX_DAYS) {
    return NextResponse.json({ error: `A window must be 1-${BODY_BATTERY_MAX_DAYS} days` }, { status: 400 });
  }
  if (daysBetweenDateStr(to, userDateStr()) < 0) {
    return NextResponse.json({ error: 'A window cannot end in the future' }, { status: 400 });
  }

  try {
    // Slower than the cron's 250 ms: a history import is hundreds of sleep calls
    // in a row, and 250 ms drew a 429 about 400 calls in (2026-10-24).
    const result = await syncGarminWellnessForUser(auth.userId, { from, to, sleepSpacingMs: IMPORT_SLEEP_SPACING_MS });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status: 500 });
  }
}
