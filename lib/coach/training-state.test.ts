/**
 * Run with `bun test`.
 *
 * The first test is the load-bearing one. It pins a bug that only appeared
 * when the assembler was run against real data on a Thursday.
 */

import { expect, test } from 'bun:test';
import { parseTrainingDays, trendOf } from '@/lib/coach/training-state';

test('a trend needs four complete weeks, and refuses rather than guessing', () => {
  // Three weeks cannot support a two-vs-two comparison. Returning a direction
  // from two data points would be a trend line through noise.
  expect(trendOf([20, 25, 30]).direction).toBeNull();
  expect(trendOf([20, 25, 30]).recent).toBeNull();

  // Four weeks: mean(28,32)=30 vs mean(20,20)=20 -> +50%, rising.
  const t = trendOf([20, 20, 28, 32]);
  expect(t.recent).toBe(30);
  expect(t.prior).toBe(20);
  expect(t.pctChange).toBeCloseTo(50, 1);
  expect(t.direction).toBe('rising');
});

test('the deadband stops an ordinary week reading as a trend', () => {
  // 26 vs 26 km is flat, and must say so. One missed 8 km run out of 30 is
  // 27% on its own, so a tighter band would report a direction every week.
  expect(trendOf([26, 26, 26.2, 25.8]).direction).toBe('flat');
  // Just inside the 10% band.
  expect(trendOf([20, 20, 21, 21]).direction).toBe('flat');
  // Just outside it.
  expect(trendOf([20, 20, 23, 23]).direction).toBe('rising');
  expect(trendOf([20, 20, 17, 17]).direction).toBe('falling');
});

test('null weeks are skipped, not counted as zero', () => {
  // A week with no elevation reading is unmeasured, not a flat week. Counting
  // it as 0 m would manufacture a collapse in the vert trend.
  const withNulls = trendOf([200, null, 220, null, 210, 230]);
  expect(withNulls.recent).toBe(220); // mean(210, 230)
  expect(withNulls.prior).toBe(210); // mean(200, 220)
  expect(withNulls.direction).toBe('flat');
});

test('training_days parses the free text the field actually holds', () => {
  // The real stored value, with role annotations in parentheses.
  expect(
    parseTrainingDays('Sunday, Monday (quality - VO2max, threshold, tempo, fartlek), Wednesday, Friday (long run)'),
  ).toEqual(['Sunday', 'Monday', 'Wednesday', 'Friday']);

  // Always returned in week order, whatever order they were typed in.
  expect(parseTrainingDays('Friday, Monday')).toEqual(['Monday', 'Friday']);
});

test('an unset training_days is null, never "every day"', () => {
  // Null propagates to adherence.rate, which then reports "cannot be measured".
  // Treating unset as all-seven would score adherence at a trivial 100% and
  // hide the one unvalidated human-entered field in the whole chain.
  expect(parseTrainingDays(null)).toBeNull();
  expect(parseTrainingDays('')).toBeNull();
  expect(parseTrainingDays('   ')).toBeNull();
  expect(parseTrainingDays('whenever I feel like it')).toBeNull();
});
