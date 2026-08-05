export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabase } from '@/lib/db/supabase';
import {
  DEFAULT_DAYS_BACK,
  getIntervalsClientForUser,
  syncIntervalsForUser,
  type IntervalsSyncResult,
} from '@/lib/intervals/sync';
import type { IntervalsToken } from '@/lib/db/types';

/**
 * Scheduled intervals.icu sync.
 *
 * Steady-state only — a few days of recent activity, enough to absorb a missed
 * run. The `days` query parameter is an escape hatch for filling a specific
 * gap, deliberately capped: historical reconciliation belongs to
 * `scripts/backfill-intervals.ts`, which is dry-run-first and reports what it
 * would change. Doing that catch-up here would perform the migration unattended
 * with the result buried in a log.
 */
const MAX_CRON_DAYS_BACK = 14;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requested = Number(request.nextUrl.searchParams.get('days'));
  const daysBack =
    Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), MAX_CRON_DAYS_BACK)
      : DEFAULT_DAYS_BACK;

  try {
    const { data: tokens } = await supabase.from('intervals_tokens').select('user_id');

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ message: 'No intervals.icu tokens found' });
    }

    const results: (Partial<IntervalsSyncResult> & { userId: string; error?: string })[] = [];

    for (const row of tokens as Pick<IntervalsToken, 'user_id'>[]) {
      // Single-user today, but one athlete's bad credential must not cost
      // everyone else their sync.
      try {
        const connection = await getIntervalsClientForUser(row.user_id);
        if (!connection) {
          results.push({ userId: row.user_id, error: 'no credentials' });
          continue;
        }
        results.push(await syncIntervalsForUser(row.user_id, connection.client, { daysBack }));
      } catch (err) {
        results.push({ userId: row.user_id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ success: true, daysBack, results });
  } catch (error) {
    console.error('Cron intervals sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
