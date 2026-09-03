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
