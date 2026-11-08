/** Run with `bun test`. Shapes taken from the real 2026-11-08 activity (25012791902). */

import { expect, test } from 'bun:test';
import {
  fitDataToLapsAndStream,
  garminGmtToIso,
  isGarminRun,
  toNormalizedGarminRun,
  watchClimb,
} from '@/lib/ingest/garmin-activity';
import { intervalsBehindMessage } from '@/lib/garmin/feed';
import { unzip, fitFromGarminDownload } from '@/lib/garmin/unzip';
import { deflateRawSync } from 'node:zlib';
import type { GarminActivitySummary } from '@/lib/garmin/types';

const nov8: GarminActivitySummary = {
  activityId: 25012791902,
  activityName: 'Hod HaSharon Running',
  startTimeGMT: '2026-11-08 18:15:37',
  activityType: { typeKey: 'running' },
  distance: 3121.49,
  duration: 1529.5,
  movingDuration: 1494,
  averageHR: 129,
  maxHR: 145,
  averageRunningCadenceInStepsPerMinute: 148.5,
  elevationGain: 73,
  elevationLoss: 45,
};

test('GMT start time becomes a UTC instant', () => {
  expect(garminGmtToIso('2026-11-08 18:15:37')).toBe('2026-11-08T18:15:37.000Z');
  expect(garminGmtToIso(null)).toBeNull();
});

test('only running activities are imported', () => {
  expect(isGarminRun(nov8)).toBe(true);
  expect(isGarminRun({ ...nov8, activityType: { typeKey: 'treadmill_running' } })).toBe(true);
  expect(isGarminRun({ ...nov8, activityType: { typeKey: 'strength_training' } })).toBe(false);
});

test('a run maps with the watch climb, no GAP, true-spm cadence and moving time', async () => {
  const r = toNormalizedGarminRun(nov8, async () => null)!;
  expect(r.externalId).toBe('garmin_25012791902');
  expect(r.dataSource).toBe('garmin_api');
  expect(r.distanceKm).toBeCloseTo(3.121, 3);
  expect(r.durationMin).toBeCloseTo(24.9, 1);
  expect(r.elevationGainM).toBe(73);
  expect(r.elevationLossM).toBe(45);
  expect(r.gapPaceMinKm).toBeNull();
  expect(r.cadenceSpm).toBe(149);
});

test('a run before the switch gets no climb from the watch', () => {
  const r = toNormalizedGarminRun({ ...nov8, startTimeGMT: '2026-11-07 06:00:00' }, async () => null)!;
  expect(r.elevationGainM).toBeNull();
  expect(r.elevationLossM).toBeNull();
});

test('a treadmill reporting 0 m is unmeasured, not flat', () => {
  expect(watchClimb({ ...nov8, activityType: { typeKey: 'treadmill_running' }, elevationGain: 0, elevationLoss: 0 }))
    .toEqual({ gain: null, loss: null });
  expect(watchClimb({ ...nov8, activityType: { typeKey: 'treadmill_running' }, elevationGain: 120 }))
    .toEqual({ gain: 120, loss: 0 });
  expect(watchClimb({ ...nov8, elevationGain: 0, elevationLoss: 0 })).toEqual({ gain: 0, loss: 0 });
});

test('an unusable summary is skipped, not imported as zero', () => {
  expect(toNormalizedGarminRun({ ...nov8, distance: 0 }, async () => null)).toBeNull();
  expect(toNormalizedGarminRun({ ...nov8, startTimeGMT: null }, async () => null)).toBeNull();
});

test('FIT laps and records become laps and an HR stream', () => {
  const p = fitDataToLapsAndStream({
    laps: [{ total_distance: 1, total_timer_time: 492, avg_heart_rate: 122, max_heart_rate: 132, avg_cadence: 74 }],
    records: [{ heart_rate: 120, elapsed_time: 0 }, { elapsed_time: 1 }, { heart_rate: 123, elapsed_time: 2 }],
  });
  expect(p.laps[0]).toMatchObject({ lapNumber: 1, distanceKm: 1, durationSec: 492, avgHr: 122, cadenceSpm: 148, avgPaceStr: '8:12' });
  expect(p.hrStream).toEqual({ hr: [120, 123], time: [0, 2] });
  expect(fitDataToLapsAndStream({}).hrStream).toBeNull();
});

function zipOf(name: string, data: Buffer): Buffer {
  const comp = deflateRawSync(data);
  const nameB = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameB.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + nameB.length + comp.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameB.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameB, comp, central, nameB, eocd]);
}

test('the zip reader returns the .fit inside', () => {
  const fit = Buffer.concat([Buffer.from([14, 0x10, 0, 0, 0, 0, 0, 0]), Buffer.from('.FIT'), Buffer.alloc(200, 7)]);
  const z = zipOf('25012791902_ACTIVITY.fit', fit);
  expect(unzip(z)[0].name).toBe('25012791902_ACTIVITY.fit');
  expect(fitFromGarminDownload(z).equals(fit)).toBe(true);
  expect(fitFromGarminDownload(fit).equals(fit)).toBe(true);
  expect(() => unzip(Buffer.alloc(40))).toThrow();
});

test('intervals.icu falling behind is named, with how many runs and since when', () => {
  expect(intervalsBehindMessage(null)).toBeNull();
  const m = intervalsBehindMessage({
    connected: true, keyExpiresAt: null, keyDaysLeft: null, lastSuccessAt: null, lastError: null,
    cooldownUntil: null, daysWithReadings7d: 7, latestReadingDay: null,
    runsAwaitingIntervals: 2, oldestAwaitingRun: '2026-11-08T18:15:37Z',
  })!;
  expect(m).toContain('2 runs');
  expect(m).toContain('since 2026-11-08');
});
