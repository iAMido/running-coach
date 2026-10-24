/**
 * What a Garmin feed status means for the coach — pure, so the rules are
 * testable without a database.
 *
 * Two different questions, two functions:
 *   - `garminFeedGaps`: what the coach CANNOT see right now (rendered under
 *     "WHAT COULD NOT BE MEASURED" via training-state `gaps[]`).
 *   - `garminFeedProblem`: whether something needs fixing (a supervisor `warn`,
 *     counted in Coach Health). Not connected is not a problem — it is a choice.
 */

import { GARMIN_KEY_WARN_DAYS, type GarminFeedStatus } from '@/lib/db/garmin-wellness';

/** Two cron runs a day; 36 h without a success means at least two missed. */
export const GARMIN_STALE_HOURS = 36;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null;
}

export function garminFeedGaps(status: GarminFeedStatus | null, now: Date = new Date()): string[] {
  if (!status) return [];
  if (!status.connected) {
    return ['Garmin recovery feed not connected — body battery, stress, sleep stages and HRV status are unknown.'];
  }
  if (status.keyDaysLeft !== null && status.keyDaysLeft < 0) {
    return [`Garmin key expired on ${status.keyExpiresAt} — body battery, stress, sleep stages and HRV status stopped updating.`];
  }
  const age = hoursSince(status.lastSuccessAt, now);
  if (age === null || age > GARMIN_STALE_HOURS) {
    return [
      `Garmin recovery data last synced ${age === null ? 'never' : `${Math.round(age)} hours ago`} — recent body battery, stress and HRV status are unknown, not fine.`,
    ];
  }
  return [];
}

export function garminFeedProblem(status: GarminFeedStatus | null, now: Date = new Date()): string | null {
  if (!status || !status.connected) return null;
  if (status.keyDaysLeft !== null && status.keyDaysLeft < 0) return `Garmin key expired on ${status.keyExpiresAt}.`;
  const age = hoursSince(status.lastSuccessAt, now);
  if (age === null || age > GARMIN_STALE_HOURS) {
    return `Garmin sync has not succeeded for ${age === null ? 'ever' : `${Math.round(age)} h`}${status.lastError ? `: ${status.lastError}` : ''}.`;
  }
  if (status.keyDaysLeft !== null && status.keyDaysLeft <= GARMIN_KEY_WARN_DAYS) {
    return `Garmin key expires in ${status.keyDaysLeft} days — rotate it on /coach/intervals.`;
  }
  return null;
}
