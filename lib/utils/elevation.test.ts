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
  TREADMILL_VERT_TABLE,
  VERT_SESSION_MIN_M_PER_KM,
  gradePercent,
  indoorAwareGain,
  looksIndoor,
  treadmillVertPerHour,
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
  const ATHLETE_STEEPEST_EVER = 20.2; // New York, 2025-10-31
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
  expect(climbCategory(11.7)).toBe('Rolling'); // his p90
  expect(climbCategory(15)).toBe('Hilly');
  expect(climbCategory(25)).toBe('Mountain');

  // Bands are ordered descending so `find` returns the tightest match.
  const floors = CLIMB_BANDS.map((b) => b.minVertPerKm);
  expect([...floors].sort((a, b) => b - a)).toEqual(floors);
});

test('the vert-session threshold clears the cluster at his p95', () => {
  // Fires on 1 of 128 recorded runs. A threshold matching a third of his
  // history would be measuring his neighbourhood, not his training.
  expect(VERT_SESSION_MIN_M_PER_KM).toBe(15);
  expect(8.8).toBeLessThan(VERT_SESSION_MIN_M_PER_KM); // median run: not a vert session
  expect(20.2).toBeGreaterThan(VERT_SESSION_MIN_M_PER_KM); // steepest ever: is one

  // The regression this test exists for. The first version of this threshold
  // was 12, which is EXACTLY his p95 — five ordinary 5-8 km easy and recovery
  // runs sat at 12.0-12.7 and would have been relabelled hill sessions on a
  // one-metre difference in recorded climb. Every one of those must stay below
  // the line, and his steepest Israeli run (12.7) is the binding case.
  for (const clusterRun of [12.0, 12.1, 12.7]) {
    expect(clusterRun).toBeLessThan(VERT_SESSION_MIN_M_PER_KM);
    expect(climbCategory(clusterRun)).toBe('Rolling');
  }
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
  // His steepest Israeli run reads as ordinary, because it is.
  expect(formatVert(127, 10)).toBe('[+127m, 12.7 m/km — Rolling]');
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

test('grade percent is the actionable unit alongside m/km', () => {
  // A treadmill console shows percent, not m/km. 1300 m over 21 km is 6.2%.
  expect(gradePercent(1300, 21)).toBeCloseTo(6.19, 2);
  expect(gradePercent(null, 21)).toBeNull();
  expect(gradePercent(1300, 0)).toBeNull();
});

test('treadmill vert maths is what makes an indoor prescription executable', () => {
  // At grade G%, a km climbs 10*G m, so an hour at S km/h climbs 10*G*S.
  expect(treadmillVertPerHour(12, 5)).toBe(600);
  expect(treadmillVertPerHour(10, 5.5)).toBeCloseTo(550, 0);
  // Nonsense in, zero out — never a negative or NaN reaching a prompt.
  expect(treadmillVertPerHour(0, 5)).toBe(0);
  expect(treadmillVertPerHour(12, 0)).toBe(0);
  expect(treadmillVertPerHour(NaN, 5)).toBe(0);

  // The table the prompt prescribes from must be internally consistent.
  for (const row of TREADMILL_VERT_TABLE) {
    expect(row.vertPerHour).toBe(Math.round(treadmillVertPerHour(row.gradePercent, row.speedKmh)));
  }
});

test('an indoor session reporting 0 m is UNMEASURED, not flat', () => {
  // Most treadmills never tell the watch their incline. Storing that 0 would
  // make a 700 m vertical workout read as a flat one: red climb row, and the
  // weekly loop firing vert_below_phase on a week executed perfectly.
  expect(indoorAwareGain(0, 'Treadmill Running')).toBeNull();
  expect(indoorAwareGain(0, 'Indoor Run')).toBeNull();
  expect(indoorAwareGain(0, 'ריצה על הליכון')).toBeNull();
  expect(indoorAwareGain(0, 'Evening Run', 'VirtualRun')).toBeNull();

  // Outdoors, 0 m IS a measurement — a genuinely flat run.
  expect(indoorAwareGain(0, 'Evening Run')).toBe(0);

  // A treadmill that DOES report incline is believed.
  expect(indoorAwareGain(420, 'Treadmill Running')).toBe(420);

  // Absent stays absent regardless.
  expect(indoorAwareGain(null, 'Treadmill Running')).toBeNull();
});

test('looksIndoor covers the equipment vocabulary the coach prescribes', () => {
  for (const name of ['Treadmill Running', 'Indoor Run', 'הליכון', 'StairMaster session', 'Gym vertical']) {
    expect(looksIndoor(name)).toBe(true);
  }
  expect(looksIndoor('Evening Run')).toBe(false);
  expect(looksIndoor(null)).toBe(false);
});
