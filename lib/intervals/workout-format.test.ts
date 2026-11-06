/**
 * Run with `bun test`.
 *
 * Elevation reaches the watch as a NOTE. These pin that it is present when
 * prescribed, absent when not, and that it never becomes a workout step —
 * intervals.icu's parser has no elevation syntax, and inventing one would
 * malform the workout rather than enrich it.
 */

import { expect, test } from 'bun:test';
import { planWorkoutToDescription } from '@/lib/intervals/workout-format';
import type { Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';

const BANDS: ZoneBands = {
  z1: { low: 0, high: 124 }, z2: { low: 124, high: 143 }, z3: { low: 143, high: 155 },
  z4: { low: 155, high: 168 }, z5: { low: 168, high: 181 }, z6: { low: 181, high: 191 },
};
const MAX_HR = 191;

function workout(over: Partial<Workout> = {}): Workout {
  return { type: 'Long Run', duration: '90 min', target_hr: 'Z1-Z2 (125-145)', ...over };
}

test('a prescribed climb reaches the watch as a note', () => {
  const t = planWorkoutToDescription(workout({ elevation_gain_m: 470 }), BANDS, MAX_HR)!;
  expect(t.notes.some((n) => n.includes('Target climb: 470 m'))).toBe(true);
  // And NOT as a step — the description is only parser syntax.
  expect(t.description).not.toContain('470');
  expect(t.description).toMatch(/^- \d+m [\d.]+-[\d.]+% HR$/);
});

test('no prescribed climb pushes nothing — never "0 m"', () => {
  // A flat plan must not tell the watch the session is deliberately flat.
  const t = planWorkoutToDescription(workout(), BANDS, MAX_HR)!;
  expect(t.notes.some((n) => n.includes('Target climb'))).toBe(false);
});

test('a zero climb is a real prescription and does travel', () => {
  // Distinct from absent: someone deliberately prescribing a flat session.
  const t = planWorkoutToDescription(workout({ elevation_gain_m: 0 }), BANDS, MAX_HR)!;
  expect(t.notes.some((n) => n.includes('Target climb: 0 m'))).toBe(true);
});

test('the indoor alternative rides along', () => {
  const t = planWorkoutToDescription(
    workout({
      indoor_alternative: {
        type: 'Incline treadmill',
        equipment: 'treadmill',
        duration: '70 min',
        description: 'Descent NOT covered — add eccentric step-downs.',
      },
    }),
    BANDS,
    MAX_HR,
  )!;
  const note = t.notes.find((n) => n.startsWith('If indoors:'))!;
  expect(note).toContain('Incline treadmill');
  expect(note).toContain('Descent NOT covered');
});

test('the HR steps are unchanged by any of this', () => {
  // The parser-facing half must stay byte-identical to what was verified live
  // against intervals.icu, whatever notes are attached.
  const plain = planWorkoutToDescription(workout(), BANDS, MAX_HR)!;
  const loaded = planWorkoutToDescription(
    workout({ elevation_gain_m: 470, indoor_alternative: { type: 'Stairs', equipment: 'stairwell' } }),
    BANDS,
    MAX_HR,
  )!;
  expect(loaded.description).toBe(plain.description);
  expect(loaded.bpmLow).toBe(plain.bpmLow);
  expect(loaded.bpmHigh).toBe(plain.bpmHigh);
});

// ── Structured steps (2026-11-06) ────────────────────────────────────────────
// The expected text is the syntax probed live against intervals.icu: header
// lines for warm-up / cool-down, cue BEFORE duration, "Nx" blocks closed by a
// blank line, and a target-less recovery step.

const hillReps: Workout = {
  type: 'Hill Repeats', duration: '35 min', target_hr: 'Z2-Z3 (130-155)',
  description: 'Short hill sprints for power.',
  steps: [
    { kind: 'warmup', min: 10, hr: 'Z1-Z2 (115-135)', cue: 'Easy jog' },
    { kind: 'repeat', reps: 6, steps: [
      { kind: 'work', sec: 45, hr: 'Z3-Z4 (150-165)', cue: 'Hard uphill' },
      { kind: 'recovery', sec: 90, cue: 'Walk down' },
    ] },
    { kind: 'cooldown', min: 10, hr: 'Z1 (100-124)' },
  ],
};

test('steps render in the probed structured syntax', () => {
  const t = planWorkoutToDescription(hillReps, BANDS, MAX_HR)!;
  expect(t.structured).toBe(true);
  expect(t.description).toBe([
    'Warmup',
    '- Easy jog 10m 60.3-70.6% HR',
    '',
    '6x',
    '- Hard uphill 45s',
    '- Walk down 90s',
    '',
    'Cooldown',
    '- 10m 52.4-64.9% HR',
  ].join('\n'));
  expect(t.minutes).toBe(Math.round((600 + 6 * 135 + 600) / 60));
});

test('short reps carry no HR alert and say why', () => {
  const t = planWorkoutToDescription(hillReps, BANDS, MAX_HR)!;
  expect(t.notes.some((n) => n.includes('by effort'))).toBe(true);
});

test('long work reps keep their HR target', () => {
  const t = planWorkoutToDescription({
    type: 'Threshold', duration: '50 min', target_hr: 'Z4 (155-168)',
    steps: [
      { kind: 'warmup', min: 15, hr: 'Z2 (124-143)' },
      { kind: 'repeat', reps: 3, steps: [{ kind: 'work', min: 6, hr: 'Z4 (155-168)', cue: 'Threshold' }, { kind: 'recovery', min: 2, cue: 'Jog' }] },
      { kind: 'cooldown', min: 10, hr: 'Z1-Z2 (115-135)' },
    ],
  }, BANDS, MAX_HR)!;
  expect(t.description).toContain('- Threshold 6m 81.2-87.9% HR');
  expect(t.description).toContain('- Jog 2m');
  expect(t.notes.some((n) => n.includes('by effort'))).toBe(false);
});

test('no steps → the v1 single steady step, byte for byte', () => {
  const t = planWorkoutToDescription(workout(), BANDS, MAX_HR)!;
  expect(t.structured).toBe(false);
  expect(t.description).toBe('- 90m 65.5-75.9% HR');
});

test('unusable steps fall back to the steady step', () => {
  const t = planWorkoutToDescription(workout({ steps: [{ kind: 'work' }] }), BANDS, MAX_HR)!;
  expect(t.structured).toBe(false);
  expect(t.description).toBe('- 90m 65.5-75.9% HR');
});

test('cues cannot inject parser syntax', () => {
  const t = planWorkoutToDescription({
    type: 'Hills', duration: '20 min', target_hr: 'Z2 (124-143)',
    steps: [{ kind: 'steady', min: 20, hr: 'Z2 (124-143)', cue: '5x 45s Z3 uphill (15 m/km)' }],
  }, BANDS, MAX_HR)!;
  expect(t.description).toBe('- uphill 20m 65-74.8% HR');
});

test('the coach description and strength travel as notes, never as steps', () => {
  const t = planWorkoutToDescription({
    ...hillReps,
    description: '- WU rolling | 6x',
    strength: { name: 'Hill strength A', duration_minutes: 20, exercises: [{ exercise: 'Step-downs', sets: 3, reps: 10, each_side: true }] },
  }, BANDS, MAX_HR)!;
  const coach = t.notes.find((n) => n.startsWith('Coach:'))!;
  expect(coach).toBe('Coach: - WU rolling | 6x.');
  expect(t.notes.some((n) => n.includes('Step-downs 3×10 each side'))).toBe(true);
  expect(t.notes.every((n) => !n.startsWith('-') && !/\d+x$/i.test(n))).toBe(true);
});

test('steps that disagree with the planned duration are flagged', () => {
  const t = planWorkoutToDescription({ ...hillReps, duration: '70 min' }, BANDS, MAX_HR)!;
  expect(t.notes.some((n) => n.startsWith('Steps add up to'))).toBe(true);
});
