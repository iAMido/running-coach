import { expect, test } from 'bun:test';
import { carryForwardSteps, checkWorkoutSteps, describePlanSteps } from '@/lib/coach/plan-steps';
import type { PlanStep, Workout } from '@/lib/db/types';

const hills: PlanStep[] = [
  { kind: 'warmup', min: 10, hr: 'Z1-Z2 (115-135)', cue: 'Easy jog' },
  { kind: 'repeat', reps: 6, steps: [{ kind: 'work', sec: 45, cue: 'Hard uphill' }, { kind: 'recovery', sec: 90, cue: 'Walk down' }] },
  { kind: 'cooldown', min: 10 },
];

test('steps that add up to the session pass', () => {
  // 10 + 6 × 2.25 + 10 = 33.5 min against 35 min.
  expect(checkWorkoutSteps({ type: 'Hill Repeats', duration: '35 min', steps: hills })).toEqual([]);
});

test('steps far from the duration are an error', () => {
  const p = checkWorkoutSteps({ type: 'Hill Repeats', duration: '60 min', steps: hills });
  expect(p.some((x) => x.severity === 'error' && x.message.includes('34 min'))).toBe(true);
});

test('no steps is not a problem', () => {
  expect(checkWorkoutSteps({ type: 'Easy Run', duration: '40 min' })).toEqual([]);
});

test('a step without a duration and a nested repeat are errors', () => {
  const p = checkWorkoutSteps({
    type: 'Intervals', duration: '30 min',
    steps: [{ kind: 'steady' }, { kind: 'repeat', reps: 2, steps: [{ kind: 'repeat', reps: 2, steps: [] }] }],
  });
  expect(p.filter((x) => x.severity === 'error').length).toBeGreaterThanOrEqual(2);
});

test('compact rendering shows the structure for the reviewer', () => {
  expect(describePlanSteps(hills)).toBe('WU 10m Z1-Z2 (115-135) · 6×(work 45s / rec 90s) · CD 10m');
});

test('adjust keeps steps only for an unchanged session', () => {
  const before: Workout = { type: 'Hill Repeats', duration: '35 min', steps: hills };
  expect(carryForwardSteps({ type: 'Hill Repeats', duration: '35 min' }, before).steps).toBe(hills);
  expect(carryForwardSteps({ type: 'Hill Repeats', duration: '45 min' }, before).steps).toBeUndefined();
  expect(carryForwardSteps({ type: 'Easy Run', duration: '35 min' }, before).steps).toBeUndefined();
});
