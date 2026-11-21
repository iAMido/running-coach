/**
 * Run with `bun test`.
 *
 * Strength goes to the watch as its own WeightTraining workout (2026-11-21).
 * The expected text follows the syntax probed live against intervals.icu —
 * see the header of strength-format.ts.
 */

import { expect, test } from 'bun:test';
import { setAmount, setCue, setSeconds, strengthCue, strengthToWorkout } from '@/lib/intervals/strength-format';
import { planWorkoutToDescription } from '@/lib/intervals/workout-format';
import { previewWeek } from '@/lib/intervals/push-week';
import type { PlannedStrength, PlanWeek, TrainingPlan, Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';

const BANDS: ZoneBands = {
  z1: { low: 0, high: 124 }, z2: { low: 124, high: 143 }, z3: { low: 143, high: 155 },
  z4: { low: 155, high: 168 }, z5: { low: 168, high: 181 }, z6: { low: 181, high: 191 },
};
const MAX_HR = 191;

/** The active plan's Monday session (0fe23633, weeks 1-3), as stored. */
const FOUNDATION_A: PlannedStrength = {
  name: 'Foundation A: hips and single-leg',
  duration_minutes: 25,
  focus: 'Clean single-leg patterns and hip stability, slow tempo.',
  exercises: [
    { exercise: 'Bodyweight squat (3s down, 1s up)', sets: 3, reps: '10-12', load: 'bodyweight', note: 'Slow tempo, knees track toes', rest_seconds: 45 },
    { exercise: 'Low step-up (15-20cm box)', sets: 3, reps: '8-10', each_side: true, load: 'bodyweight', rest_seconds: 45 },
    { exercise: 'Glute bridge', sets: 3, reps: '12-15', load: 'bodyweight', note: 'Pause 2s at top', rest_seconds: 45 },
    { exercise: 'Single-leg balance', sets: 2, reps: '30-45s', each_side: true, load: 'bodyweight', rest_seconds: 30 },
    { exercise: 'Side plank', sets: 2, reps: '20-30s', each_side: true, load: 'bodyweight', rest_seconds: 30 },
    { exercise: 'Bird dog', sets: 1, reps: '8', each_side: true, load: 'bodyweight', rest_seconds: 30 },
  ],
};

test('each exercise becomes a repeat block of timed sets with a rest countdown', () => {
  const t = strengthToWorkout(FOUNDATION_A)!;
  expect(t.name).toBe('Strength: Foundation A: hips and single-leg');
  expect(t.description).toBe([
    '3x',
    '- Bodyweight squat (3 sec down, 1 sec up) 10-12 reps 1m',
    '- Rest 45s',
    '',
    '3x',
    '- Low step-up (15-20cm box) 8-10 reps each side 90s',
    '- Rest 45s',
    '',
    '3x',
    '- Glute bridge 12-15 reps 70s',
    '- Rest 45s',
    '',
    '2x',
    '- Single-leg balance 30-45 sec each side 100s',
    '- Rest 30s',
    '',
    '2x',
    '- Side plank 20-30 sec each side 70s',
    '- Rest 30s',
    '',
    '- Bird dog 8 reps each side 75s',
  ].join('\n'));
  // Every set is a step the athlete sees: 3+3+3+2+2+1.
  expect(t.cues.length).toBe(14);
  expect(t.summary).toContain('Glute bridge 3×12-15 reps');
});

test('loads and coaching notes travel as notes, never inside the steps', () => {
  const t = strengthToWorkout(FOUNDATION_A)!;
  expect(t.description).not.toContain('bodyweight');
  expect(t.notes).toContain('Bodyweight squat (3s down, 1s up): bodyweight — Slow tempo, knees track toes');
  expect(t.notes[0]).toContain('about 25 min');
  expect(t.notes.every((n) => !n.startsWith('-') && !/\d+\s*x$/i.test(n))).toBe(true);
});

test('no kilogram figure is ever invented', () => {
  const t = strengthToWorkout(FOUNDATION_A)!;
  expect(`${t.description}\n${t.notes.join('\n')}`).not.toMatch(/\d\s*kg/i);
});

test('cue text cannot carry the shapes the parser reads as durations or targets', () => {
  // Each one measured live: "%" became a power target, '"' and a standalone
  // "3s" became the step's duration, "2 hr" was eaten.
  expect(strengthCue('Squat 70% 1RM')).toBe('Squat 70pct 1RM');
  expect(strengthCue('Plank 30"')).toBe('Plank 30');
  expect(strengthCue('Heel raises · 3s lowering')).toBe('Heel raises · 3 sec lowering');
  expect(strengthCue('Hold 2 hr')).toBe('Hold 2 hour');
  expect(strengthCue('Walking lunge 20m')).toBe('Walking lunge 20 metres');
  expect(strengthCue('Easy spin 10min')).toBe('Easy spin 10 min');
  expect(strengthCue('Step-up (15-20cm box)')).toBe('Step-up (15-20cm box)');
  expect(strengthCue('Squat Z2 bpm')).toBe('Squat');
  // Idempotent: a cue cleaned twice is the same cue.
  const once = strengthCue('Bodyweight squat (3s down, 1s up) 30-45s');
  expect(strengthCue(once)).toBe(once);
});

test('no step line can contain a duration token before its own duration', () => {
  const t = strengthToWorkout({
    name: 'Trap test',
    exercises: [
      { exercise: 'Heel raises · 3s lowering', sets: 3, reps: '12-15' },
      { exercise: 'Squat at 70% 1RM', sets: 2, reps: 5, load: '70% 1RM' },
      { exercise: 'Plank', sets: 3, seconds: 40 },
      { exercise: 'Farmer carry 20m', sets: 2, reps: '1' },
    ],
  })!;
  for (const line of t.description.split('\n').filter((l) => l.startsWith('- '))) {
    const body = line.replace(/ \d+(?:m|s)$/, '');
    expect(body).not.toMatch(/(?:^|\s)\d+(?:\.\d+)?(?:s|m|h|km|mi|mtr|"|')(?:\s|$)/);
    expect(body).not.toContain('%');
    expect(line).toMatch(/ \d+(?:m|s)$/);
  }
});

test('timed holds are sized by the hold, reps by a slow tempo, both sides doubled', () => {
  expect(setSeconds({ exercise: 'Plank', sets: 3, seconds: 40 })).toBe(50);
  expect(setSeconds({ exercise: 'Side plank', sets: 2, reps: '20-30s', each_side: true })).toBe(70);
  expect(setSeconds({ exercise: 'Squat', sets: 3, reps: '10-12' })).toBe(60);
  expect(setSeconds({ exercise: 'Step-up', sets: 3, reps: '8-10', each_side: true })).toBe(90);
  expect(setAmount({ exercise: 'Plank', sets: 3, seconds: 40 })).toBe('40 sec');
  expect(setAmount({ exercise: 'Dead bug', sets: 2, reps: '8-10', each_side: true })).toBe('8-10 reps each side');
});

test('a long exercise name is shortened, never the reps', () => {
  const cue = setCue('Rear-foot-elevated split squat with a slow eccentric and a pause at the bottom', '6-8 reps each side');
  expect(cue.length).toBeLessThanOrEqual(60);
  expect(cue.endsWith('6-8 reps each side')).toBe(true);
  // Real case from the plan: the tempo detail is dropped whole, never cut mid-bracket.
  expect(setCue('Tempo split squat (3s down, 1s pause, 1s up)', '8-10 reps each side')).toBe('Tempo split squat 8-10 reps each side');
  expect(setCue('Copenhagen plank (short holds, knee on bench)', '10-15 sec each side')).toBe('Copenhagen plank 10-15 sec each side');
  // Short enough: the parenthetical stays.
  expect(setCue('Bodyweight squat (3s down, 1s up)', '10-12 reps')).toBe('Bodyweight squat (3 sec down, 1 sec up) 10-12 reps');
});

test('a session without exercises pushes nothing', () => {
  expect(strengthToWorkout(null)).toBeNull();
  expect(strengthToWorkout({ name: 'Empty', exercises: [] })).toBeNull();
});

// ── The week push ───────────────────────────────────────────────────────────

const PLAN = { id: 'plan-1', start_date: '2026-11-08' } as TrainingPlan;
const easy: Workout = { type: 'Easy Run', duration: '30 min', target_hr: 'Z2 (124-143)' };

test('a strength day pushes the run, then the strength session as its own WeightTraining event', () => {
  const week = { week_number: 3, workouts: { Monday: { ...easy, type: 'Easy Run + Strength', strength: FOUNDATION_A } } } as unknown as PlanWeek;
  const rows = previewWeek(PLAN, week, 3, BANDS, MAX_HR, '2026-11-21');
  expect(rows.map((r) => [r.date, r.workoutName, r.eventType ?? 'Run'])).toEqual([
    ['2026-11-23', 'Easy Run + Strength', 'Run'],
    ['2026-11-23', 'Strength: Foundation A: hips and single-leg', 'WeightTraining'],
  ]);
  // The run points at it rather than listing every exercise.
  const pointer = rows[0].notes.find((n) => n.startsWith('Strength after the run'))!;
  expect(pointer).toContain('its own workout on the watch');
  expect(pointer).not.toContain('Glute bridge');
});

test('a run-only day is untouched: one Run row, same description and notes as before', () => {
  const week = { week_number: 3, workouts: { Monday: easy } } as unknown as PlanWeek;
  const rows = previewWeek(PLAN, week, 3, BANDS, MAX_HR, '2026-11-21');
  expect(rows.length).toBe(1);
  expect(rows[0].eventType).toBeUndefined();
  const direct = planWorkoutToDescription(easy, BANDS, MAX_HR)!;
  expect(rows[0].description).toBe(direct.description);
  expect(rows[0].description).toBe('- 30m 65-74.8% HR');
  expect(rows[0].notes).toEqual([]);
});
