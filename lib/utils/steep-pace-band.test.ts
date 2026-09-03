/**
 * Run with `bun test`.
 *
 * The pace ceiling is the gate that stopped standing-still laps being averaged
 * in as slow running. Raising it for climbing sessions is a real risk, so these
 * pin both halves: power-hiking counts on a climb, and nothing else changes.
 */

import { expect, test } from 'bun:test';
import {
  MAX_PLAUSIBLE_PACE_MIN_KM,
  MAX_PLAUSIBLE_PACE_MIN_KM_STEEP,
  MIN_LAP_DURATION_SEC,
  STEEP_CEILING_MIN_M_PER_KM,
  computeDecoupling,
} from '@/lib/utils/decoupling';
import { isEfEligible } from '@/lib/utils/efficiency';

/** Eight even laps, so only the pace band decides the outcome. */
function laps(paces: number[]) {
  return paces.map((p) => ({ durationSec: 300, avgHr: 145, gapPaceMinKm: p }));
}

const HIKING = [7, 7.2, 17, 18, 7.1, 7.3, 16.5, 7.4];

test('power-hiking is discarded on a flat run and counted on a climb', () => {
  // Flat: three hiking laps are 37% of the session, past the exclusion cap.
  const flat = computeDecoupling(laps(HIKING), 'Long Run', 8.8);
  expect(flat.decouplingPct).toBeNull();
  expect(flat.skippedReason).toContain('not running pace');

  // Same session on race-like gradient: the hiking is the work.
  const steep = computeDecoupling(laps(HIKING), 'Trail Long Run', 62);
  expect(steep.decouplingPct).not.toBeNull();
});

test('an unmeasured gradient keeps the road ceiling — absent is not steep', () => {
  // 560 runs carry no elevation. None of them may silently acquire a wider
  // band just because the field is missing.
  expect(computeDecoupling(laps(HIKING), 'Long Run', null).decouplingPct).toBeNull();
  expect(computeDecoupling(laps(HIKING), 'Long Run', undefined).decouplingPct).toBeNull();
});

test('standing still is still excluded, even on a climb', () => {
  // The real contaminating laps from this athlete's history: 88.9 / 36 / 29
  // min/km. Well past the steep ceiling, so they stay out at any gradient.
  const stopped = [7, 7.2, 88.9, 36, 7.1, 7.3, 29, 7.4];
  expect(computeDecoupling(laps(stopped), 'Trail Long Run', 62).decouplingPct).toBeNull();
  expect(MAX_PLAUSIBLE_PACE_MIN_KM_STEEP).toBeLessThan(29);
});

test('short degenerate laps cannot slip in under the raised ceiling', () => {
  // 1-3 second laps covering a few metres exist in this data and resolve to
  // 13-29 min/km. Under the road ceiling they were excluded by pace; the steep
  // ceiling would have admitted them, so duration excludes them first — but
  // ONLY on the steep path, because 79 laps across 50 runs are under 30 s
  // inside the normal band and must not be retroactively dropped.
  const withFragments = [
    { durationSec: 300, avgHr: 145, gapPaceMinKm: 7 },
    { durationSec: 300, avgHr: 145, gapPaceMinKm: 7.2 },
    { durationSec: 1, avgHr: 140, gapPaceMinKm: 13.9 },
    { durationSec: 3, avgHr: 140, gapPaceMinKm: 29.2 },
    { durationSec: 300, avgHr: 145, gapPaceMinKm: 17 },
    { durationSec: 300, avgHr: 146, gapPaceMinKm: 18 },
    { durationSec: 300, avgHr: 147, gapPaceMinKm: 16.5 },
    { durationSec: 300, avgHr: 148, gapPaceMinKm: 7.4 },
    { durationSec: 300, avgHr: 149, gapPaceMinKm: 7.5 },
  ];
  const r = computeDecoupling(withFragments, 'Trail Long Run', 62);
  // Computes, and the fragments did not push it past the exclusion cap.
  expect(r.decouplingPct).not.toBeNull();
  expect(MIN_LAP_DURATION_SEC).toBe(30);

  // The flat path must still count those short laps, unchanged.
  const flatShort = [
    { durationSec: 300, avgHr: 145, gapPaceMinKm: 7 },
    { durationSec: 20, avgHr: 145, gapPaceMinKm: 7.2 },
    { durationSec: 300, avgHr: 145, gapPaceMinKm: 7.1 },
    { durationSec: 300, avgHr: 146, gapPaceMinKm: 7.3 },
    { durationSec: 300, avgHr: 147, gapPaceMinKm: 7.4 },
    { durationSec: 300, avgHr: 148, gapPaceMinKm: 7.5 },
    { durationSec: 300, avgHr: 149, gapPaceMinKm: 7.6 },
  ];
  expect(computeDecoupling(flatShort, 'Easy', 8).decouplingPct).not.toBeNull();
});

test('efficiency agrees with decoupling about what counts as running', () => {
  const base = { date: '2026-09-01', runType: 'Long Run', durationMin: 120, avgHr: 145 };
  // 16 min/km is out on the flat...
  expect(isEfEligible({ ...base, gapPaceMinKm: 16, vertPerKm: 8 })).toBe(false);
  // ...and in on a climb. If these two disagreed, the scorecard would show a
  // session decoupling measured but efficiency ignored, with no explanation.
  expect(isEfEligible({ ...base, gapPaceMinKm: 16, vertPerKm: 62 })).toBe(true);
  // Unmeasured gradient keeps the road ceiling.
  expect(isEfEligible({ ...base, gapPaceMinKm: 16, vertPerKm: null })).toBe(false);
});

test('the steep threshold is the vert-session threshold, not a second number', () => {
  // One definition of "this is a climbing session", shared. Two would drift.
  expect(STEEP_CEILING_MIN_M_PER_KM).toBe(15);
  expect(MAX_PLAUSIBLE_PACE_MIN_KM).toBe(12);
  expect(MAX_PLAUSIBLE_PACE_MIN_KM_STEEP).toBe(22);
});
