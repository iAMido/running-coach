import { describe, expect, test } from 'bun:test';
import { formatRunLaps, isRealLap } from './user-formatter';
import { formatPace } from '@/lib/utils/pace';
import type { Lap } from '@/lib/db/types';

const lap = (n: number, km: number, sec: number, hr: number): Lap =>
  ({ lap_number: n, distance_km: km, duration_sec: sec, avg_hr: hr, gap_pace_min_km: 6 } as Lap);

describe('formatRunLaps keeps short interval reps', () => {
  // The 2026-11-16 hill session: 1 km warm-up, a 0.44 km lap, then 7 × (45 s up / 90 s back)
  // at 128-152 m and 180-198 m, then cool-down. Every rep used to be dropped by a 200 m filter.
  const laps: Lap[] = [lap(1, 1.003, 419, 126), lap(2, 0.437, 182, 145)];
  for (let i = 0; i < 7; i++) {
    laps.push(lap(3 + i * 2, 0.13, 45, 148), lap(4 + i * 2, 0.19, 90, 145));
  }
  laps.push(lap(17, 0.998, 454, 135), lap(18, 0.316, 146, 141), lap(19, 0.152, 70, 144));

  test('every rep and recovery reaches the coach', () => {
    const text = formatRunLaps(laps);
    for (let n = 1; n <= 19; n++) expect(text).toContain(`L${n}:`);
    expect(text).not.toContain('more laps');
  });

  test('pace never reads x:60', () => {
    expect(formatPace(5.9997)).toBe('6:00');
    expect(formatPace(4.9999)).toBe('5:00');
    expect(formatPace(5.5)).toBe('5:30');
  });

  test('lap-button fragments are still dropped', () => {
    expect(isRealLap({ distance_km: 0.002, duration_sec: 1 })).toBe(false);
    expect(isRealLap({ distance_km: 0.006, duration_sec: 3 })).toBe(false);
    expect(isRealLap({ distance_km: 0.062, duration_sec: 30 })).toBe(true);
    expect(isRealLap({ distance_km: 0.13, duration_sec: 45 })).toBe(true);
    expect(isRealLap({ distance_km: null, duration_sec: null } as unknown as Lap)).toBe(true);
  });
});
