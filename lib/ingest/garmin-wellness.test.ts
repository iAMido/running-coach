/** Run with `bun test`. Synthetic values only — no real health data in fixtures. */
import { expect, test } from 'bun:test';
import {
  bodyBatteryAtWake,
  gmtMs,
  mapDailySummaries,
  mapHrv,
  mapSleep,
  mergeGarminDays,
  score,
} from './garmin-wellness';
import type { GarminBodyBatteryReport, GarminDailySleep } from '@/lib/garmin/types';
import { chunkRange, dayList } from '@/lib/garmin/sync';

const WAKE = Date.parse('2026-10-23T04:14:00Z'); // 07:14 in Israel (UTC+3)

const night: GarminDailySleep = {
  calendarDate: '2026-10-23',
  sleepTimeSeconds: 23_400,
  deepSleepSeconds: 4_000,
  lightSleepSeconds: 13_000,
  remSleepSeconds: 5_000,
  awakeSleepSeconds: 1_400,
  awakeCount: 2,
  avgSleepStress: 18.4,
  avgHeartRate: 49.6,
  averageRespirationValue: 14.2,
  averageSpO2Value: 95.3,
  sleepStartTimestampGMT: WAKE - 23_400_000 - 1_400_000,
  sleepEndTimestampGMT: WAKE,
  sleepScores: { overall: { value: 84, qualifierKey: 'GOOD' } },
  sleepNeed: { actual: 480, baseline: 460 },
};

const battery: GarminBodyBatteryReport = {
  date: '2026-10-23',
  charged: 55,
  drained: 60,
  bodyBatteryValueDescriptorDTOList: [
    { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' },
    { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryStatus' },
    { bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' },
  ],
  bodyBatteryValuesArray: [
    [WAKE - 3 * 3_600_000, 'MEASURED', 40],
    [WAKE - 6 * 60_000, 'MEASURED', 71],
    [WAKE + 20 * 60_000, 'MEASURED', 69],
    [WAKE + 3 * 3_600_000, 'MEASURED', 52],
  ],
};

test('absent and Garmin\'s negative markers are null, never 0', () => {
  expect(score(-1)).toBeNull();
  expect(score(-2)).toBeNull();
  expect(score(null)).toBeNull();
  expect(score(undefined)).toBeNull();
  expect(score(0)).toBe(0); // a real zero is kept; the per-field mapper decides plausibility
  expect(score(101)).toBeNull(); // rejected, not clamped
});

test('GMT timestamps: epoch ms and "YYYY-MM-DD HH:mm:ss" are both UTC', () => {
  expect(gmtMs(1_761_192_840_000)).toBe(1_761_192_840_000);
  expect(gmtMs('2026-10-19 16:51:25')).toBe(Date.parse('2026-10-19T16:51:25Z'));
  expect(gmtMs('')).toBeNull();
  expect(gmtMs(0)).toBeNull();
});

test('HRV keeps Garmin\'s status and baseline band, keyed by calendarDate', () => {
  const m = mapHrv([
    { calendarDate: '2026-10-23', lastNightAvg: 63, weeklyAvg: 60, status: 'LOW', baseline: { balancedLow: 62, balancedUpper: 74 } },
    { calendarDate: 'not-a-date', lastNightAvg: 50 },
  ]);
  expect(m.size).toBe(1);
  expect(m.get('2026-10-23')).toEqual({
    hrv_last_night: 63, hrv_weekly_avg: 60, hrv_baseline_low: 62, hrv_baseline_high: 74, hrv_status: 'LOW',
  });
});

test('a night with the watch off has null HRV, not 0', () => {
  expect(mapHrv([{ calendarDate: '2026-10-23', lastNightAvg: 0, status: null }]).get('2026-10-23')?.hrv_last_night).toBeNull();
});

test('daily summary: stress -1 (not measured) is null; high-stress time converts ms to s', () => {
  const m = mapDailySummaries([
    {
      calendarDate: '2026-10-23',
      heartRate: { restingValue: 50 },
      stress: { avgLevel: -1, maxLevel: 88, qualifier: 'BALANCED', highStressDurationInMillis: 1_800_000 },
      bodyBattery: { minValue: 12, maxValue: 71, chargedValue: 55, drainedValue: 60 },
    },
  ]).get('2026-10-23')!;
  expect(m.stress_avg).toBeNull();
  expect(m.stress_max).toBe(88);
  expect(m.stress_high_secs).toBe(1800);
  expect(m.resting_hr).toBe(50);
  expect(m.body_battery_max).toBe(71);
});

test('sleep maps stages, the nested overall score and ISO start/end', () => {
  const s = mapSleep(night, '2026-10-23')!;
  expect(s.day).toBe('2026-10-23');
  expect(s.columns.sleep_secs).toBe(23_400);
  expect(s.columns.sleep_score).toBe(84);
  expect(s.columns.sleep_deep_secs).toBe(4_000);
  expect(s.columns.sleep_stress_avg).toBe(18.4);
  expect(s.columns.sleep_end).toBe('2026-10-23T04:14:00.000Z');
});

test('a night with no recorded sleep is not a night — no sleep columns from it', () => {
  expect(mapSleep(null, '2026-10-23')).toBeNull();
  expect(mapSleep({ calendarDate: '2026-10-23', sleepTimeSeconds: 0 }, '2026-10-23')).toBeNull();
});

test('sleep is filed under the WAKE date even across midnight (night of 22->23 is the 23rd)', () => {
  const s = mapSleep({ ...night, calendarDate: undefined }, '2026-10-23')!;
  expect(s.day).toBe('2026-10-23');
});

test('body battery at wake: nearest reading to sleep end, located by descriptor not position', () => {
  expect(bodyBatteryAtWake(battery, WAKE)).toBe(71); // 6 min before beats 20 min after
});

test('body battery at wake: nothing within 30 min, or no descriptors, is null — never a guess', () => {
  expect(bodyBatteryAtWake(battery, WAKE + 2 * 3_600_000)).toBeNull();
  expect(bodyBatteryAtWake({ ...battery, bodyBatteryValueDescriptorDTOList: [] }, WAKE)).toBeNull();
  expect(bodyBatteryAtWake(battery, null)).toBeNull();
});

test('merge: a component that FAILED contributes no keys, so the upsert keeps its columns', () => {
  const rows = mergeGarminDays('u1', ['2026-10-23'], {
    hrv: [{ calendarDate: '2026-10-23', lastNightAvg: 63, status: 'LOW' }],
    // summaries, sleep and body battery failed this run
  });
  expect(rows[0].hrv_last_night).toBe(63);
  expect('sleep_secs' in rows[0]).toBe(false);
  expect('stress_avg' in rows[0]).toBe(false);
  expect('body_battery_at_wake' in rows[0]).toBe(false);
});

test('merge: a component that succeeded but has no data for a day writes explicit nulls', () => {
  const rows = mergeGarminDays('u1', ['2026-10-22', '2026-10-23'], {
    sleep: new Map([['2026-10-22', null], ['2026-10-23', night]]),
  });
  expect(rows[0].sleep_secs).toBeNull();
  expect('sleep_secs' in rows[0]).toBe(true);
  expect(rows[1].sleep_secs).toBe(23_400);
  // every row carries the same key set — what a batch upsert needs
  expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
});

test('merge: at-wake body battery needs both sleep and body battery from this run', () => {
  const both = mergeGarminDays('u1', ['2026-10-23'], {
    sleep: new Map([['2026-10-23', night]]),
    bodyBattery: [battery],
  });
  expect(both[0].body_battery_at_wake).toBe(71);

  const noSleep = mergeGarminDays('u1', ['2026-10-23'], { bodyBattery: [battery] });
  expect('body_battery_at_wake' in noSleep[0]).toBe(false);
});


test('dayList is inclusive and oldest first; chunks never exceed the body-battery limit', () => {
  const days = dayList('2026-09-01', '2026-10-24');
  expect(days[0]).toBe('2026-09-01');
  expect(days.at(-1)).toBe('2026-10-24');
  expect(days).toHaveLength(54);
  const chunks = chunkRange(days, 28);
  expect(chunks).toEqual([['2026-09-01', '2026-09-28'], ['2026-09-29', '2026-10-24']]);
  expect(dayList('2026-10-24', '2026-10-23')).toEqual([]);
});

test('dayList crosses the Israel DST change (2026-10-25) without skipping or repeating a day', () => {
  expect(dayList('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
});
