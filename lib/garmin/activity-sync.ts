/**
 * Garmin activity pass (2026-11-09). Runs AFTER the intervals.icu sync in both
 * the cron and sync-on-open, and does two things:
 *
 *   1. Imports any run Garmin has that intervals.icu has not delivered — so a
 *      stalled intervals.icu (the dormant account of 2026-11-08) no longer
 *      means a missing run. Goes through `upsertRun` like every provider; a
 *      run intervals.icu already delivered is a fuzzy match and costs no file
 *      download. When intervals.icu catches up it takes the row over (fills
 *      GAP, swaps in its laps) — see `enrichExisting`.
 *   2. Puts the watch's climb on every run since WATCH_CLIMB_FROM, the source
 *      the athlete chose (`applyWatchClimb`).
 *
 * Shares the wellness sync's token, cooldown and expiry rules. Never throws.
 */

import { getGarminToken, updateGarminToken } from '@/lib/db/garmin-wellness';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { daysBetweenDateStr, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import { GarminRateLimitedError } from '@/lib/garmin/client';
import { garminClientFromToken } from '@/lib/garmin/sync';
import { fitFromGarminDownload } from '@/lib/garmin/unzip';
import {
  isGarminRun,
  parseFit,
  toNormalizedGarminRun,
  watchClimb,
  WATCH_CLIMB_FROM,
  garminGmtToIso,
  type ParsedFit,
} from '@/lib/ingest/garmin-activity';
import { applyWatchClimb, once, upsertRun } from '@/lib/ingest/upsert-run';

export const GARMIN_ACTIVITY_DAYS_BACK = 7;
const DEFAULT_COOLDOWN_SEC = 3600;

export interface GarminActivitySyncResult {
  skipped?: 'not_connected' | 'key_expired' | 'cooldown';
  seen: number;
  imported: number;
  watchClimbApplied: number;
  errors: string[];
}

export async function syncGarminActivitiesForUser(
  userId: string,
  options: { daysBack?: number } = {},
): Promise<GarminActivitySyncResult> {
  const result: GarminActivitySyncResult = { seen: 0, imported: 0, watchClimbApplied: 0, errors: [] };
  try {
    const token = await getGarminToken(userId);
    if (!token) return { ...result, skipped: 'not_connected' };
    const today = userDateStr();
    if (daysBetweenDateStr(today, token.key_expires_at) < 0) return { ...result, skipped: 'key_expired' };
    if (token.cooldown_until && Date.parse(token.cooldown_until) > Date.now()) return { ...result, skipped: 'cooldown' };

    const client = garminClientFromToken(token);
    const from = userDateStrDaysAgo(Math.max(1, options.daysBack ?? GARMIN_ACTIVITY_DAYS_BACK) - 1);
    const activities = (await client.listActivities(from, today)).filter(isGarminRun);
    result.seen = activities.length;
    if (!activities.length) return result;

    const profile = await getAthleteProfile(userId);
    const zoneBands = parseZonesFromProfile(profile);
    const activePlan = once(() => getActivePlan(userId));

    for (const a of activities) {
      try {
        const loadFit = once(async (): Promise<ParsedFit | null> => {
          try {
            return await parseFit(fitFromGarminDownload(await client.downloadActivityFile(a.activityId)));
          } catch (err) {
            result.errors.push(`file ${a.activityId}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        });
        const run = toNormalizedGarminRun(a, loadFit);
        if (!run) continue;

        // Not authoritative: intervals.icu's identity (filename, timestamp) wins a fuzzy match.
        const upserted = await upsertRun(userId, run, { profile, zoneBands, activePlan, identityIsAuthoritative: false });
        if (upserted.created) result.imported++;

        if ((garminGmtToIso(a.startTimeGMT) ?? '').slice(0, 10) >= WATCH_CLIMB_FROM) {
          if (await applyWatchClimb(upserted.runId, watchClimb(a), profile)) result.watchClimbApplied++;
        }
      } catch (err) {
        if (err instanceof GarminRateLimitedError) throw err;
        result.errors.push(`activity ${a.activityId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    if (err instanceof GarminRateLimitedError) {
      await updateGarminToken(userId, {
        cooldown_until: new Date(Date.now() + (err.retryAfterSec ?? DEFAULT_COOLDOWN_SEC) * 1000).toISOString(),
      }).catch(() => {});
    }
  }
  return result;
}
