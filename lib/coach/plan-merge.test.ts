/** Run with `bun test`. Built on week 1 of the active plan and the 2026-11-10 rewrite. */

import { expect, test } from 'bun:test';
import { mergeAdjustedWeek, weekChanged } from '@/lib/coach/plan-merge';
import type { PlanWeek } from '@/lib/db/types';

const strengthA = { name: 'Foundation A', exercises: [] } as never;
const strengthB = { name: 'Foundation B', exercises: [] } as never;
const before: PlanWeek = {
  week_number: 1, phase: 'Re-entry Block', focus: 'Restore rhythm', total_km: 15,
  workouts: {
    Sunday: { type: 'Recovery Run', duration: '25 min', target_hr: 'Z1 (110-124)', steps: [{ kind: 'steady', min: 25 }] },
    Monday: { type: 'Hill Repeats + Strength', distance: '4 km', duration: '35 min', target_hr: 'Z2-Z3 (130-155)',
      description: 'WU | 6x45s uphill | CD', strength: strengthA, steps: [{ kind: 'warmup', min: 12 }], source: 'Uphill Athlete',
      indoor_alternative: { type: 'Incline Treadmill', equipment: 'treadmill', description: '6x45s' } as never },
    Wednesday: { type: 'Easy Run + Strength', distance: '2.5 km', duration: '20 min', target_hr: 'Z1-Z2 (120-140)',
      strength: strengthB, steps: [{ kind: 'steady', min: 20 }] },
    Friday: { type: 'Easy Long Run', distance: '5.5 km', duration: '45 min' },
  },
};

// What the model wrote on 2026-11-10: the same sessions, strength and steps gone, a description reworded.
const restated: PlanWeek = JSON.parse(JSON.stringify(before));
for (const w of Object.values(restated.workouts)) { delete w.strength; delete w.steps; delete w.source; }
restated.workouts.Monday.description += ' — already completed and executed correctly';

test('a restatement is not a change, so nothing is written', () => {
  expect(weekChanged(before, restated)).toBe(false);
  expect(weekChanged(before, { ...restated, workouts: { ...restated.workouts, Tuesday: { type: '—' } as never } })).toBe(false);
});

test('a restated day keeps strength, steps, source and indoor alternative', () => {
  const m = mergeAdjustedWeek(before, restated);
  expect(m.workouts.Monday.strength).toBe(strengthA);
  expect(m.workouts.Monday.steps?.length).toBe(1);
  expect(m.workouts.Monday.source).toBe('Uphill Athlete');
  expect(m.workouts.Wednesday.strength).toBe(strengthB);
});

test('moving Wednesday to Thursday is a change, and the session takes its strength and steps along', () => {
  const moved: PlanWeek = JSON.parse(JSON.stringify(restated));
  moved.workouts.Thursday = moved.workouts.Wednesday;
  delete moved.workouts.Wednesday;
  expect(weekChanged(before, moved)).toBe(true);
  const m = mergeAdjustedWeek(before, moved);
  expect(m.workouts.Thursday.strength).toBe(strengthB);
  expect(m.workouts.Thursday.steps?.length).toBe(1);
  expect(m.workouts.Wednesday).toBeUndefined();
});

test('a genuinely changed session keeps new values, and steps only when the duration still matches', () => {
  const changed: PlanWeek = JSON.parse(JSON.stringify(restated));
  changed.workouts.Wednesday = { ...changed.workouts.Wednesday, duration: '30 min', distance: '3.5 km' };
  expect(weekChanged(before, changed)).toBe(true);
  const m = mergeAdjustedWeek(before, changed);
  expect(m.workouts.Wednesday.steps).toBeUndefined();
  expect(m.workouts.Wednesday.strength).toBe(strengthB);
  expect(m.workouts.Friday.strength).toBeUndefined();
});
