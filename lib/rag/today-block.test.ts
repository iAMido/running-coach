/** Run with `bun test`. The real 2026-11-12 case: Thursday, Wednesday's run missed. */

import { expect, test } from 'bun:test';
import { formatTodayBlock } from '@/lib/rag/today-block';
import type { TrainingPlan } from '@/lib/db/types';

const plan = {
  start_date: '2026-11-08', duration_weeks: 8,
  plan_json: { weeks: [{ week_number: 1, phase: 'Re-entry', workouts: {
    Sunday: { type: 'Recovery Run', duration: '25 min', target_hr: 'Z1 (110-124)' },
    Monday: { type: 'Hill Repeats + Strength', duration: '35 min' },
    Wednesday: { type: 'Easy Run + Strength', distance: '2.5 km', duration: '20 min', target_hr: 'Z1-Z2 (120-140)' },
    Friday: { type: 'Easy Long Run', distance: '5.5 km', duration: '45 min' },
  } }] },
} as unknown as TrainingPlan;

const runs = [
  { date: '2026-11-08T18:15:37Z', distance_km: 3.12, run_type: 'Recovery' },
  { date: '2026-11-09T18:06:19Z', distance_km: 4.98, run_type: 'Intervals' },
];

test('Thursday, 12 Nov: today is stated, Wednesday is shown as missed, Friday is tomorrow', () => {
  const t = formatTodayBlock(plan, runs, new Date('2026-11-12T15:53:00Z'));
  expect(t).toContain('Today is Thursday, 12 Nov 2026');
  expect(t).toContain('Yesterday — Wednesday, 11 Nov 2026: planned Easy Run + Strength, 2.5 km, 20 min, HR Z1-Z2 (120-140); done: no run recorded');
  expect(t).toContain('Today — Thursday, 12 Nov 2026: planned rest day');
  expect(t).toContain('Tomorrow — Friday, 13 Nov 2026: planned Easy Long Run');
  expect(t).toContain('never against the date of the most recent run');
});

test('days are Israel days: 23:30 Israel on Sunday is still Sunday', () => {
  const t = formatTodayBlock(plan, [{ date: '2026-11-08T21:30:00Z', distance_km: 5 }], new Date('2026-11-08T21:45:00Z'));
  expect(t).toContain('Today is Sunday, 8 Nov 2026');
  expect(t).toContain('done: run 5.0 km');
});

test('no plan says so', () => {
  expect(formatTodayBlock(null, [], new Date('2026-11-12T10:00:00Z'))).toContain('planned no active plan');
});
