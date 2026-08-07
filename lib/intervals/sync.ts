/**
 * One user's intervals.icu sync.
 *
 * Shared by the manual route and the cron so the two cannot drift — the same
 * duplication that made Phase 1 necessary in the first place.
 *
 * ## Scope
 *
 * This is the STEADY-STATE sync: a few days of recent activity. It is
 * deliberately not the migration. Historical reconciliation belongs to
 * `scripts/backfill-intervals.ts`, which is dry-run-first and reports what it
 * would change — running a 400-day catch-up through here would perform the same
 * writes unattended, with the result buried in a cron log.
 */

import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { supabase } from '@/lib/db/supabase';
import { upsertWellnessDays } from '@/lib/db/wellness';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { userDateStrDaysAgo, userDateStr } from '@/lib/utils/user-time';
import { upsertRun, once } from '@/lib/ingest/upsert-run';
import { filterRuns, toNormalizedRun, toNormalizedWellness } from '@/lib/ingest/intervals';
import { IntervalsClient } from '@/lib/intervals/client';
import { decryptSecret, looksEncrypted } from '@/lib/intervals/crypto';
import type { IntervalsToken } from '@/lib/db/types';

/** Steady-state activity window. Enough to absorb a missed cron run. */
export const DEFAULT_DAYS_BACK = 3;

/**
 * Wellness is pulled over a wider window than activities, on purpose.
 *
 * It is one API call whatever the range, so there is no cost argument for
 * matching `daysBack`. And there is a correctness argument against it:
 * intervals.icu recomputes ctl/atl retroactively as activities land, so a
 * 3-day wellness window would leave the preceding weeks' fitness/fatigue values
 * stale — exactly the series the readiness verdict reads.
 */
export const WELLNESS_DAYS_BACK = 30;

export interface IntervalsSyncResult {
  userId: string;
  newRunsCount: number;
  lapsBackfilledCount: number;
  /**
   * Rows whose stored timestamp was corrected.
   *
   * ALARM, not statistic. After the Phase 7 backfill runs once, the correct
   * steady-state value is 0 forever. Non-zero on a routine sync means the
   * identity reconciliation is fighting something — most likely a provider
   * changed its date convention, or Strava sync was re-enabled and is
   * competing for the same rows.
   */
  dateCorrected: number;
  wellnessDaysUpserted: number;
  /** Non-fatal per-activity failures. */
  errors: string[];
}

/**
 * How stale `last_sync_at` must be before opening the app triggers a sync.
 *
 * Long enough that a burst of navigation costs one API round trip, short enough
 * that a run uploaded during breakfast is on the dashboard by the time it is
 * looked at.
 */
export const AUTO_SYNC_STALE_MINUTES = 30;

export interface SyncClaim {
  claimed: boolean;
  /** `last_sync_at` as it was before the claim — restored if the sync throws. */
  previous: string | null;
  /** The stamp written by this claim, so a rollback only reverts its own write. */
  stamp: string | null;
  reason: 'claimed' | 'fresh' | 'raced' | 'not_connected';
}

/**
 * Take the right to run an automatic sync, atomically.
 *
 * Read-then-check is not enough here. Until sync-on-open existed the only two
 * callers were crons six hours apart, so no two syncs could ever overlap. Two
 * devices opening the app in the same ten seconds can, and both would find no
 * existing row for a brand-new activity and both insert it — the duplicate this
 * codebase has spent days eliminating, reintroduced through the front door.
 *
 * So the claim is a compare-and-swap: write `last_sync_at` only if it still
 * holds the value we just read. The loser sees zero updated rows and skips.
 *
 * This briefly makes `last_sync_at` mean "started" rather than "completed",
 * which is why a failure restores it — otherwise one error would suppress
 * automatic syncing for the whole debounce window and, worse, leave a timestamp
 * claiming a sync that never happened. Cron and manual syncs do not claim and
 * keep the original write-on-completion behaviour.
 */
export async function claimAutoSync(
  userId: string,
  staleMinutes: number = AUTO_SYNC_STALE_MINUTES,
): Promise<SyncClaim> {
  const { data } = await supabase
    .from('intervals_tokens')
    .select('last_sync_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { claimed: false, previous: null, stamp: null, reason: 'not_connected' };

  const previous = (data as { last_sync_at: string | null }).last_sync_at;
  if (previous) {
    const age = Date.now() - Date.parse(previous);
    if (Number.isFinite(age) && age < staleMinutes * 60_000) {
      return { claimed: false, previous, stamp: null, reason: 'fresh' };
    }
  }

  const stamp = new Date().toISOString();
  const update = supabase.from('intervals_tokens').update({ last_sync_at: stamp }).eq('user_id', userId);
  // Postgres equality never matches NULL, so the absent case needs `is`.
  const guarded = previous === null ? update.is('last_sync_at', null) : update.eq('last_sync_at', previous);
  const { data: rows } = await guarded.select('user_id');

  if (!rows || rows.length === 0) {
    return { claimed: false, previous, stamp: null, reason: 'raced' };
  }
  return { claimed: true, previous, stamp, reason: 'claimed' };
}

/**
 * Undo a claim whose sync failed.
 *
 * Guarded on the stamp this claim wrote so it can never overwrite a *newer*
 * successful sync that landed in between.
 */
export async function releaseAutoSyncClaim(userId: string, claim: SyncClaim): Promise<void> {
  if (!claim.claimed || !claim.stamp) return;
  await supabase
    .from('intervals_tokens')
    .update({ last_sync_at: claim.previous })
    .eq('user_id', userId)
    .eq('last_sync_at', claim.stamp);
}

export interface IntervalsSyncOptions {
  daysBack?: number;
  wellnessDaysBack?: number;
  /** Skip the morning-after coach note (backfills, where it is noise). */
  generateCoachNote?: boolean;
}

/** Load and decrypt one user's credentials. */
export async function getIntervalsClientForUser(
  userId: string,
): Promise<{ client: IntervalsClient; token: IntervalsToken } | null> {
  const { data, error } = await supabase
    .from('intervals_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  const token = data as IntervalsToken;

  // A plaintext key means something wrote the row bypassing the connect route.
  // Refuse rather than silently normalising it — the whole point of the column
  // comment is that plaintext must never be load-bearing.
  if (!looksEncrypted(token.api_key)) {
    throw new Error(
      'intervals_tokens.api_key is not encrypted. Reconnect via /coach/intervals so it is stored correctly.',
    );
  }

  return {
    client: new IntervalsClient({ apiKey: decryptSecret(token.api_key), athleteId: token.athlete_id }),
    token,
  };
}

export async function syncIntervalsForUser(
  userId: string,
  client: IntervalsClient,
  options: IntervalsSyncOptions = {},
): Promise<IntervalsSyncResult> {
  const daysBack = options.daysBack ?? DEFAULT_DAYS_BACK;
  const wellnessDaysBack = options.wellnessDaysBack ?? WELLNESS_DAYS_BACK;

  const result: IntervalsSyncResult = {
    userId,
    newRunsCount: 0,
    lapsBackfilledCount: 0,
    dateCorrected: 0,
    wellnessDaysUpserted: 0,
    errors: [],
  };

  // Fetched once per request and threaded down, same as the Strava routes.
  const profile = await getAthleteProfile(userId);
  const zoneBands = parseZonesFromProfile(profile);
  const activePlan = once(() => getActivePlan(userId));

  const newest = userDateStr();
  const activities = await client.getActivities(userDateStrDaysAgo(daysBack), newest);
  const runs = filterRuns(activities);

  // Caught the day it happens, not the next time someone pushes a workout —
  // the value is already in hand on every activity.
  warnIfMaxHrDiverged(activities, profile?.max_hr ?? null);

  for (const activity of runs) {
    try {
      const upserted = await upsertRun(userId, toNormalizedRun(activity, client), {
        profile,
        zoneBands,
        activePlan,
        generateCoachNote: options.generateCoachNote,
        // intervals.icu carries the Garmin FIT timestamp, so on a fuzzy match
        // its date and id win. See buildEnrichPatch.
        identityIsAuthoritative: true,
      });

      if (upserted.created) result.newRunsCount++;
      else if (upserted.lapsWritten > 0) result.lapsBackfilledCount++;
      if (upserted.dateCorrected) result.dateCorrected++;
    } catch (err) {
      // One bad activity must not abort the rest of the sync.
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`icu_${activity.id}: ${message}`);
    }
  }

  // Wellness is independent of the activity loop — a run-import failure should
  // not cost the recovery data, and vice versa.
  try {
    const wellness = await client.getWellness(userDateStrDaysAgo(wellnessDaysBack), newest);
    result.wellnessDaysUpserted = await upsertWellnessDays(
      wellness.map((day) => toNormalizedWellness(userId, day)),
    );
  } catch (err) {
    result.errors.push(`wellness: ${err instanceof Error ? err.message : String(err)}`);
  }

  await supabase
    .from('intervals_tokens')
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  warnIfDatesCorrected(result);
  return result;
}

/**
 * Alarm when intervals.icu's max HR stops matching ours.
 *
 * Write-back pushes percentages, and intervals.icu resolves them against THEIR
 * max HR — so if that number moves, every workout already on the calendar
 * quietly comes to mean a different bpm range than the plan intended.
 *
 * Checked on sync rather than at push time because `athlete_max_hr` rides along
 * on every activity payload, so the divergence is catchable the day it happens
 * for free. A hard refusal still belongs at push time; this is the early
 * warning, not the gate.
 */
export function warnIfMaxHrDiverged(activities: { athlete_max_hr?: number | null }[], profileMaxHr: number | null | undefined): void {
  if (!profileMaxHr) return;
  const theirs = activities.map((a) => a.athlete_max_hr).find((v) => typeof v === 'number');
  if (typeof theirs !== 'number' || theirs === profileMaxHr) return;

  console.warn(
    `[intervals-sync] WARNING: max HR disagrees — intervals.icu has ${theirs}, athlete_profile has ${profileMaxHr}. ` +
      `Pushed workouts are percentages that intervals.icu resolves against THEIR number, so every workout already on ` +
      `the calendar now means a different bpm range than intended. Reconcile before pushing again.`,
  );
}

/**
 * Surface a non-zero `dateCorrected` loudly. Post-backfill this should never
 * fire, so when it does it is a signal rather than noise.
 */
export function warnIfDatesCorrected(result: IntervalsSyncResult): void {
  if (result.dateCorrected > 0) {
    console.warn(
      `[intervals-sync] WARNING: corrected ${result.dateCorrected} stored timestamp(s) for ${result.userId}. ` +
        `Expected 0 once the Phase 7 backfill has run. Check whether Strava sync is competing for the same rows ` +
        `or a provider changed its date convention.`,
    );
  }
}
