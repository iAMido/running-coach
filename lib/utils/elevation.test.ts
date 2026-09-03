/**
 * Run with `bun test`.
 *
 * The first two tests are the load-bearing ones, and neither is about
 * arithmetic. They pin the two decisions a future reader is most likely to
 * reverse for tidiness: that an absent elevation reading must not render as
 * flat, and that the `Mountain` band is empty on purpose.
 */

import { expect, test } from 'bun:test';
import {
  CLIMB_BANDS,
  TARGET_RACE,
  VERT_SESSION_MIN_M_PER_KM,
  climbCategory,
  climbCategoryIsUnprecedented,
  formatVert,
  fractionOfRaceGradient,
  sumVert,
  vertPerKm,
} from '@/lib/utils/elevation';

test('an absent elevation reading is never a flat run', () => {
  // 560 rows in this database were nulled because someone stored "unmeasured"
  // as a number. Null in, null out — never 0.
  expect(vertPerKm(null, 10)).toBeNull();
  expect(vertPerKm(undefined, 10)).toBeNull();
  expect(climbCategory(vertPerKm(null, 10))).toBeNull();

  // And it must be visibly absent in rendered output, not silently omitted:
  // a blank would be indistinguishable from a genuinely flat run.
  expect(formatVert(null, 10)).toBe('[vert n/a]');
  expect(formatVert(0, 10)).not.toBe('[vert n/a]');
});

test('the Mountain band has no member in this athlete history, and that is the point', () => {
  // His measured maximum is 20.2 m/km over 128 runs; race day is 61.9. If a
  // future change lowers the Mountain floor to "fill" the band, this fails —
  // which is the intended outcome, because the empty band IS the training gap.
  const ATHLETE_STEEPEST_EVER = 20.2;
  expect(climbCategory(ATHLETE_STEEPEST_EVER)).toBe('Hilly');
  expect(climbCategoryIsUnprecedented(climbCategory(ATHLETE_STEEPEST_EVER))).toBe(false);

  expect(climbCategory(TARGET_RACE.vertPerKm)).toBe('Mountain');
  expect(climbCategoryIsUnprecedented(climbCategory(TARGET_RACE.vertPerKm))).toBe(true);
});

test('bands match the measured distribution they were derived from', () => {
  expect(climbCategory(2.0)).toBe('Flat'); // his historical minimum
  expect(climbCategory(4.9)).toBe('Flat');
  expect(climbCategory(5)).toBe('Rolling');
  expect(climbCategory(8.8)).toBe('Rolling'); // his median run
  expect(climbCategory(11.6)).toBe('Rolling'); // his p90
  expect(climbCategory(12)).toBe('Hilly');
  expect(climbCategory(25)).toBe('Mountain');

  // Bands are ordered descending so `find` returns the tightest match.
  const floors = CLIMB_BANDS.map((b) => b.minVertPerKm);
  expect([...floors].sort((a, b) => b - a)).toEqual(floors);
});

test('the vert-session threshold is rare on his current terrain', () => {
  // Fires on 1 of 128 recorded runs. A threshold that already matched a third
  // of his history would be measuring his neighbourhood, not his training.
  expect(VERT_SESSION_MIN_M_PER_KM).toBe(12);
  expect(8.8).toBeLessThan(VERT_SESSION_MIN_M_PER_KM); // median run: not a vert session
  expect(20.2).toBeGreaterThan(VERT_SESSION_MIN_M_PER_KM); // steepest ever: is one
});

test('race gradient is roughly 3x his steepest and 7x his median', () => {
  expect(TARGET_RACE.vertPerKm).toBeCloseTo(61.9, 1);
  expect(fractionOfRaceGradient(20.2)).toBeCloseTo(0.33, 2);
  expect(fractionOfRaceGradient(8.8)).toBeCloseTo(0.14, 2);
  expect(fractionOfRaceGradient(null)).toBeNull();
});

test('descent renders alongside climb and is positive, not a negative gain', () => {
  expect(formatVert(340, 10, 380)).toBe('[+340m / -380m, 34.0 m/km — Mountain]');
  // Loss is optional; gain alone still renders.
  expect(formatVert(88, 10)).toBe('[+88m, 8.8 m/km — Rolling]');
  // No distance means no gradient, but the raw climb is still worth stating.
  expect(formatVert(340, 0)).toBe('[+340m]');
});

test('a weekly total reports how many runs actually carried a reading', () => {
  const week = [
    { elevation_gain_m: 120 },
    { elevation_gain_m: null }, // watch had no barometer / pre-2025-08-05 row
    { elevation_gain_m: 80 },
  ];
  // 200 m across 2 measured runs of 3 — the caller must be able to say
  // "of the runs we can see", not present 200 m as the week's total climb.
  expect(sumVert(week)).toEqual({ totalM: 200, measured: 2, total: 3 });
  expect(sumVert([])).toEqual({ totalM: 0, measured: 0, total: 0 });
});
