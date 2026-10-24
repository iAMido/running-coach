/** Run with `bun test`. Synthetic values only. */
import { expect, test } from 'bun:test';
import { formatGarminRecovery } from './user-formatter';
import { garminBaselinesFrom, percentile, type GarminBaselines, type GarminFeedStatus } from '@/lib/db/garmin-wellness';
import { userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { GarminDailyWellness } from '@/lib/db/types';
import { garminFeedGaps, garminFeedProblem } from '@/lib/garmin/feed';

const baselines: GarminBaselines = {
  bbWakeMedian: 85, bbWakeP10: 75, stressMedian: 26, deepSleepMedianSecs: 3_900, sampleCount: 28, windowDays: 28,
};

function day(daysAgo: number, over: Partial<GarminDailyWellness> = {}): GarminDailyWellness {
  return {
    id: String(daysAgo), user_id: 'u', day: daysAgo === 0 ? userDateStr() : userDateStrDaysAgo(daysAgo),
    body_battery_at_wake: 85, body_battery_max: 90, stress_avg: 25, stress_qualifier: 'balanced',
    sleep_secs: 23_400, sleep_deep_secs: 4_000, sleep_rem_secs: 5_000, sleep_light_secs: 13_000,
    sleep_awake_secs: 1_400, sleep_awake_count: 2, sleep_need_mins: 480,
    hrv_status: 'BALANCED', hrv_weekly_avg: 68, hrv_baseline_low: 65, hrv_baseline_high: 73,
    ...over,
  };
}

test('nothing connected or nothing measured -> no block at all', () => {
  expect(formatGarminRecovery([], baselines)).toBe('');
});

test('body battery is placed against HIS distribution: below p10 says BELOW his usual range', () => {
  const out = formatGarminRecovery([day(1, { body_battery_at_wake: 64 })], baselines);
  expect(out).toContain('Body battery at wake');
  expect(out).toContain('64 — BELOW his usual range (median 85, 10th percentile 75)');
});

test('without enough history the block refuses to call a value high or low', () => {
  const thin = { ...baselines, bbWakeMedian: null, bbWakeP10: null };
  expect(formatGarminRecovery([day(1, { body_battery_at_wake: 40 })], thin)).toContain('no personal baseline yet');
});

test('a missing body battery reads "not measured", never as a low value', () => {
  expect(formatGarminRecovery([day(1, { body_battery_at_wake: null })], baselines)).toContain('not measured');
});

test('HRV status reports the streak — LOW for 3 days is a trend, not one night', () => {
  const out = formatGarminRecovery(
    [day(0, { hrv_status: 'LOW', hrv_weekly_avg: 58 }), day(1, { hrv_status: 'LOW' }), day(2, { hrv_status: 'LOW' }), day(3)],
    baselines,
  );
  expect(out).toContain('LOW for 3 days running');
  expect(out).toContain('7-day average 58 vs his balanced band 65–73');
});

test('stress comes from the newest COMPLETE day, not today which is still accumulating', () => {
  const out = formatGarminRecovery([day(0, { stress_avg: 5 }), day(1, { stress_avg: 31 })], baselines);
  expect(out).toContain('average 31');
  expect(out).not.toContain('average 5');
});

test('HRV value, resting HR and sleep score are not repeated (daily_wellness owns them)', () => {
  const out = formatGarminRecovery([day(1, { hrv_last_night: 63, resting_hr: 50, sleep_score: 84 })], baselines);
  expect(out).not.toContain('63ms');
  expect(out).not.toContain('Resting HR');
  expect(out).not.toContain('sleep score');
});

test('baselines: null below 10 samples; median and p10 from his own values', () => {
  const few = garminBaselinesFrom(Array.from({ length: 9 }, () => ({ body_battery_at_wake: 80, stress_avg: 20, sleep_deep_secs: 3600 })), 28);
  expect(few.bbWakeMedian).toBeNull();
  const vals = [60, 70, 75, 80, 82, 85, 88, 90, 92, 95];
  const b = garminBaselinesFrom(vals.map((v) => ({ body_battery_at_wake: v, stress_avg: 25, sleep_deep_secs: 3600 })), 28);
  expect(b.bbWakeMedian).toBe(82);
  expect(b.bbWakeP10).toBe(60);
  expect(percentile([], 50)).toBeNull();
});

const NOW = new Date('2026-10-24T18:00:00Z');
const healthy: GarminFeedStatus = {
  connected: true, keyExpiresAt: '2027-10-24', keyDaysLeft: 365, lastSuccessAt: '2026-10-24T15:00:00Z',
  lastError: null, cooldownUntil: null, daysWithReadings7d: 7, latestReadingDay: '2026-10-24',
};

test('feed: healthy -> no gap, no problem', () => {
  expect(garminFeedGaps(healthy, NOW)).toEqual([]);
  expect(garminFeedProblem(healthy, NOW)).toBeNull();
});

test('feed: not connected is a gap for the coach but not a problem to fix', () => {
  const off = { ...healthy, connected: false };
  expect(garminFeedGaps(off, NOW)[0]).toContain('not connected');
  expect(garminFeedProblem(off, NOW)).toBeNull();
});

test('feed: 36h+ without success reads as unknown, never as fine', () => {
  const stale = { ...healthy, lastSuccessAt: '2026-10-22T18:00:00Z', lastError: 'Garmin request failed (500)' };
  expect(garminFeedGaps(stale, NOW)[0]).toContain('48 hours ago');
  expect(garminFeedProblem(stale, NOW)).toContain('500');
});

test('feed: an expiring key is a problem 14 days out but not yet a gap', () => {
  const expiring = { ...healthy, keyDaysLeft: 10 };
  expect(garminFeedGaps(expiring, NOW)).toEqual([]);
  expect(garminFeedProblem(expiring, NOW)).toContain('10 days');
  expect(garminFeedGaps({ ...healthy, keyDaysLeft: -1 }, NOW)[0]).toContain('expired');
});
