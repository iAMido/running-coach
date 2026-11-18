import { expect, test } from 'bun:test';
import { dayWindow, sumDay } from './caltrack-summary';

const meal = (eaten_at: string, cal: number) => ({
  eaten_at, total_calories: cal, total_protein_g: 10.04, total_carbs_g: null, total_fat_g: 1, total_fiber_g: 0,
});

test('sums only meals on that Israel-local day', () => {
  // 21:30 UTC on the 17th is 23:30 Israel (UTC+2) on the 17th; 22:30 UTC is 00:30 on the 18th.
  const out = sumDay([meal('2026-11-17T21:30:00Z', 500), meal('2026-11-17T22:30:00Z', 300), meal('2026-11-18T12:00:00Z', 200)], '2026-11-18');
  expect(out.total_calories_in).toBe(500);
  expect(out.meal_count).toBe(2);
  expect(out.total_protein_g).toBe(20.1);
  expect(out.total_carbs_g).toBe(0);
});

test('the query window always contains the whole Israel day, summer or winter', () => {
  for (const date of ['2026-01-15', '2026-07-15']) {
    const { from, to } = dayWindow(date);
    // Israel midnight is 21:00 or 22:00 UTC the day before; the day ends 21:00/22:00 UTC on the day.
    expect(Date.parse(from)).toBeLessThanOrEqual(Date.parse(`${date}T00:00:00+03:00`));
    expect(Date.parse(to)).toBeGreaterThanOrEqual(Date.parse(`${date}T23:59:59+02:00`));
  }
});
