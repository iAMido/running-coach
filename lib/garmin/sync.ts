/**
 * Garmin wellness sync — best-effort, independent of the intervals.icu sync.
 *
 * Called from the intervals-sync cron (14 days back) and from sync-on-open
 * (2 days back) as a separate block: a Garmin failure lands in its own result
 * and never fails the intervals.icu sync. No new cron (CLAUDE.md: the Hobby
 * project's 4th cron is still unverified).
 *
 * Each endpoint is fetched separately. One that fails is left out of the
 * upsert, so its stored columns survive (see `mergeGarminDays`).
 */

import { GarminClient, GarminRateLimitedError, BODY_BATTERY_MAX_DAYS } from '@/lib/garmin/client';
import { decryptSecret, encryptSecret, looksEncrypted } from '@/lib/intervals/crypto';
import { getGarminToken, updateGarminToken, upsertGarminWellnessDays } from '@/lib/db/garmin-wellness';
import { mergeGarminDays, type GarminFetched } from '@/lib/ingest/garmin-wellness';
import { daysBetweenDateStr, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { GarminToken } from '@/lib/db/types';
import type { GarminDailySleep } from '@/lib/garmin/types';

/** Garmin recalculates recent days (HRV status, body battery); 14 also covers a late watch sync. */
export const GARMIN_WELLNESS_DAYS_BACK = 14;
/** Sync-on-open: last night and the one before. */
export const GARMIN_ON_OPEN_DAYS_BACK = 2;
/** Range chunk for every range endpoint. Body battery's measured limit; HRV/summaries take more. */
const RANGE_CHUNK_DAYS = BODY_BATTERY_MAX_DAYS;
/** Without a Retry-After, how long a 429 pauses all Garmin syncs. */
const DEFAULT_COOLDOWN_SEC = 3600;
/** Spacing between per-night sleep calls. 30 at 250 ms drew no 429 (2026-10-24). */
const SLEEP_CALL_SPACING_MS = 250;

export interface GarminSyncResult {
  userId: string;
  daysUpserted: number;
  components: { hrv: boolean; summaries: boolean; sleep: boolean; bodyBattery: boolean };
  errors: string[];
  skipped?: 'not_connected' | 'cooldown' | 'key_expired';
  /** Set when Garmin rate-limited this run or an earlier one: when it is safe to try again. */
  cooldownUntil?: string;
}

export interface GarminSyncOptions {
  /** Days back from today, inclusive of today. Ignored when `from` is set. */
  daysBack?: number;
  /** Explicit window (backfill). YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  sleepSpacingMs?: number;
}

/** Days from `from` to `to`, inclusive, oldest first. */
export function dayList(from: string, to: string): string[] {
  const n = daysBetweenDateStr(from, to);
  if (!Number.isFinite(n) || n < 0) return [];
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n + 1 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** [from, to] pairs of at most `size` days. */
export function chunkRange(days: string[], size: number): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < days.length; i += size) out.push([days[i], days[Math.min(i + size, days.length) - 1]]);
  return out;
}

/** Decrypt a stored token row into a client that persists fresh access tokens (encrypted). */
export function garminClientFromToken(token: GarminToken): GarminClient {
  if (!looksEncrypted(token.api_key)) {
    throw new Error('garmin_tokens.api_key is not encrypted. Reconnect Garmin on /coach/intervals.');
  }
  const cachedValid =
    token.access_token &&
    looksEncrypted(token.access_token) &&
    token.access_token_expires_at &&
    Date.parse(token.access_token_expires_at) > Date.now();

  return new GarminClient({
    apiKey: decryptSecret(token.api_key),
    cachedToken: cachedValid
      ? { token: decryptSecret(token.access_token!), expiresAt: new Date(token.access_token_expires_at!) }
      : null,
    onToken: async (t) => {
      await updateGarminToken(token.user_id, {
        access_token: encryptSecret(t.token),
        access_token_expires_at: t.expiresAt.toISOString(),
      });
    },
  });
}

export async function syncGarminWellnessForUser(
  userId: string,
  options: GarminSyncOptions = {},
): Promise<GarminSyncResult> {
  const result: GarminSyncResult = {
    userId,
    daysUpserted: 0,
    components: { hrv: false, summaries: false, sleep: false, bodyBattery: false },
    errors: [],
  };

  const token = await getGarminToken(userId);
  if (!token) return { ...result, skipped: 'not_connected' };

  const today = userDateStr();
  if (daysBetweenDateStr(today, token.key_expires_at) < 0) {
    await updateGarminToken(userId, { last_error: `Personal API key expired on ${token.key_expires_at}` });
    return { ...result, skipped: 'key_expired' };
  }
  if (token.cooldown_until && Date.parse(token.cooldown_until) > Date.now()) {
    return { ...result, skipped: 'cooldown', cooldownUntil: token.cooldown_until };
  }

  const client = garminClientFromToken(token);
  const from = options.from ?? userDateStrDaysAgo(Math.max(1, options.daysBack ?? GARMIN_WELLNESS_DAYS_BACK) - 1);
  const to = options.to ?? today;
  const days = dayList(from, to);
  const chunks = chunkRange(days, RANGE_CHUNK_DAYS);
  const spacing = options.sleepSpacingMs ?? SLEEP_CALL_SPACING_MS;

  const fetched: GarminFetched = {};
  let rateLimited: GarminRateLimitedError | null = null;

  // Each component is all-or-nothing for this run: a chunk failing drops the
  // whole component, so a half-fetched window never writes nulls over good data.
  async function component<T>(name: keyof GarminSyncResult['components'], run: () => Promise<T>): Promise<T | undefined> {
    if (rateLimited) return undefined;
    try {
      const value = await run();
      result.components[name] = true;
      return value;
    } catch (err) {
      if (err instanceof GarminRateLimitedError) rateLimited = err;
      result.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  fetched.hrv = await component('hrv', async () =>
    (await Promise.all(chunks.map(([a, b]) => client.getHrvRange(a, b)))).flat(),
  );
  fetched.summaries = await component('summaries', async () =>
    (await Promise.all(chunks.map(([a, b]) => client.getDailySummaries(a, b)))).flat(),
  );
  fetched.bodyBattery = await component('bodyBattery', async () =>
    (await Promise.all(chunks.map(([a, b]) => client.getBodyBatteryReports(a, b)))).flat(),
  );
  fetched.sleep = await component('sleep', async () => {
    const nights = new Map<string, GarminDailySleep | null>();
    for (const day of days) {
      nights.set(day, await client.getDailySleep(day));
      if (spacing > 0) await new Promise((r) => setTimeout(r, spacing));
    }
    return nights;
  });

  try {
    // A day no endpoint said anything about (before the watch, or a history
    // import reaching past it) gets no row: an all-null row reads as "synced,
    // nothing measured" when the truth is "nothing to sync".
    const rows = mergeGarminDays(userId, days, fetched).filter((r) => Object.keys(r.raw).length > 0);
    result.daysUpserted = await upsertGarminWellnessDays(rows);
  } catch (err) {
    result.errors.push(`upsert: ${err instanceof Error ? err.message : String(err)}`);
  }

  const anySucceeded =
    Object.values(result.components).some(Boolean) && !result.errors.some((e) => e.startsWith('upsert:'));
  const limited = rateLimited as GarminRateLimitedError | null;
  if (limited) {
    result.cooldownUntil = new Date(Date.now() + (limited.retryAfterSec ?? DEFAULT_COOLDOWN_SEC) * 1000).toISOString();
  }
  await updateGarminToken(userId, {
    last_sync_at: new Date().toISOString(),
    ...(anySucceeded ? { last_success_at: new Date().toISOString() } : {}),
    last_error: result.errors.length ? result.errors.join(' | ').slice(0, 1000) : null,
    ...(result.cooldownUntil ? { cooldown_until: result.cooldownUntil } : {}),
  });

  return result;
}
