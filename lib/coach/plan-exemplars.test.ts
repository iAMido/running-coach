/**
 * Run with `bun test`.
 *
 * The first test is the load-bearing one. Both strength-only plans supplied on
 * 2026-09-26 store EVERYTHING inside `library_workout` — no name, exercises,
 * notes or steps at the top level. An extractor that did not know to look
 * there produced two empty plans, and nothing downstream would have noticed.
 */

import { expect, test } from 'bun:test';
import {
  compressWeeks,
  detectLoadingPattern,
  distillPlan,
  distinctNotes,
  extractStrength,
  parseGoal,
  renderExemplar,
  scoreExemplar,
  selectExemplars,
  selectStrengthReference,
  type RawPlan,
  type SelectableExemplar,
} from '@/lib/coach/plan-exemplars';

// ------------------------------------------------------- four encodings

test('encoding 3: a session whose only content is library_workout is NOT empty', () => {
  const session = {
    sport: 'strength',
    type: 'weightlifting',
    name: null,
    notes: '',
    strength_exercises: null,
    canonical_steps: [],
    library_workout: {
      name: "Runner's Strength (Straight Sets)",
      steps: [
        { type: 'step' }, // warm-up, not an exercise
        {
          type: 'repeat',
          repeat_count: 3,
          steps: [{
            type: 'set', exercise_name: 'TRAP_BAR_DEADLIFT', exercise_display_name: 'Trap Bar Deadlift',
            target_reps: 6, rest_seconds: 120, target_percent_1rm: 0.75, unilateral: false, coaching_note: '(~RPE 7-8)',
          }],
        },
      ],
    },
  };
  const { strength, strengthSource } = extractStrength(session);
  expect(strengthSource).toBe('library_workout');
  expect(strength).toEqual([{
    exercise: 'Trap Bar Deadlift', sets: 3, reps: '6', seconds: null, restSeconds: 120,
    load: '75% 1RM', unilateral: false, note: '(~RPE 7-8)',
  }]);

  // The session NAME also lives on the library object, and must be read there.
  const plan: RawPlan = { name: 'S', weeks: [{ week_index: 1, phase: 'base', sessions: [session] }] };
  expect(distillPlan(plan, 's').representativeWeeks[0].sessions[0].name).toBe("Runner's Strength (Straight Sets)");
});

test('encoding 1: structured strength_exercises, with rep ranges and timed holds', () => {
  const { strength, strengthSource } = extractStrength({
    sport: 'strength',
    strength_exercises: [
      { exercise: 'Bulgarian Split Squat', sets: 3, reps: 8, reps_high: 10, rest_seconds: 90, unilateral: true },
      { exercise: 'Copenhagen Plank', sets: 3, reps: null, duration_seconds: 20, rest_seconds: 60, unilateral: true },
    ],
  });
  expect(strengthSource).toBe('strength_exercises');
  expect(strength[0].reps).toBe('8-10');
  expect(strength[0].unilateral).toBe(true);
  expect(strength[1]).toMatchObject({ exercise: 'Copenhagen Plank', reps: null, seconds: 20 });
});

test('encoding 2: canonical_steps tree, sets carried from the repeat', () => {
  const { strength, strengthSource } = extractStrength({
    sport: 'strength',
    canonical_steps: [{
      type: 'repeat', repeat_count: 3,
      steps: [{ type: 'set', exercise_display_name: 'Barbell Back Squat', target_reps: 8, rest_seconds: 60 }],
    }],
  });
  expect(strengthSource).toBe('canonical_steps');
  expect(strength[0]).toMatchObject({ exercise: 'Barbell Back Squat', sets: 3, reps: '8', restSeconds: 60 });
});

test('encoding 4: prose-only strength is recognised as strength, not as nothing', () => {
  const r = extractStrength({ sport: 'strength', notes: 'Full body: squats 3x8, RDL 3x8.' });
  expect(r.strengthSource).toBe('notes');
  expect(r.strength).toEqual([]);
});

test('precedence: the cleanest encoding wins when several are present', () => {
  const r = extractStrength({
    sport: 'strength',
    strength_exercises: [{ exercise: 'A', sets: 1, reps: 1 }],
    canonical_steps: [{ type: 'repeat', repeat_count: 9, steps: [{ type: 'set', exercise_display_name: 'B', target_reps: 9 }] }],
  });
  expect(r.strengthSource).toBe('strength_exercises');
  expect(r.strength.map((e) => e.exercise)).toEqual(['A']);
});

// ------------------------------------------------------------- the plan

test('a named race beats the first number in the description', () => {
  // "1.9 km swim" is the first number; the race is 113 km.
  expect(parseGoal('Complete a Half-Ironman (70.3): 1.9 km swim, 90 km bike, 21.1 km run').distanceKm).toBe(113);
  expect(parseGoal('Half Marathon PB').distanceKm).toBe(21.1);
  const trail = parseGoal('31 weeks to the Carmel-Kinneret 33 km on 2 April 2027 (+447 / -847 m)');
  expect(trail).toEqual({ distanceKm: 33, elevationGainM: 447, elevationLossM: 847 });
  expect(parseGoal('Fitness goal').distanceKm).toBeNull();
});

test('loading cadence is detected when regular and refused when not', () => {
  expect(detectLoadingPattern([4, 8, 12, 16, 20, 24, 28])).toBe('3:1');
  expect(detectLoadingPattern([3, 6, 9])).toBe('2:1');
  // 3:1 then 1:1 in the peak is a real design choice. Calling it "3:1" would
  // teach the model something the coach did not do.
  expect(detectLoadingPattern([4, 8, 10, 12])).toBeNull();
  expect(detectLoadingPattern([4])).toBeNull();
});

test('taper weeks do not break the cadence of the loading cycles before them', () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    week_index: i + 1,
    phase: i < 10 ? 'build' : 'taper',
    is_recovery_week: [4, 8, 11, 12].includes(i + 1),
    sessions: [],
  }));
  expect(distillPlan({ name: 'N', weeks }, 'n').loadingPattern).toBe('3:1');
});

test('coaching notes: identical templated notes collapse, a CHANGED note survives', () => {
  const mk = (week: number, note: string, recovery = false) =>
    ({ week, phase: 'build', km: null, minutes: null, recovery, elevationM: 0, note, sessions: [] });
  const notes = distinctNotes([
    mk(9, 'Build: climbs enter.'), mk(10, 'Build: climbs enter.'), mk(11, 'Build: climbs enter.'),
    mk(12, 'Recovery: about 80 %.', true),
    mk(13, 'Build: climbs enter.'),
    mk(20, 'Recovery: about 70 %.', true),
  ]);
  expect(notes.map((n) => n.weeks)).toEqual(['9-11, 13', '12', '20']);
  // The deepening deload is the progression — it must not be deduplicated away.
  expect(notes.filter((n) => n.recovery).map((n) => n.note)).toEqual(['Recovery: about 80 %.', 'Recovery: about 70 %.']);
});

test('compressWeeks renders ranges', () => {
  expect(compressWeeks([9, 10, 11, 13, 14, 15])).toBe('9-11, 13-15');
  expect(compressWeeks([4, 8, 12])).toBe('4, 8, 12');
  expect(compressWeeks([])).toBe('');
});

test('the rendering warns that days are relative, and lists irregular recovery weeks', () => {
  const plan: RawPlan = {
    name: 'Norwegian Marathon',
    weeks: [4, 8, 10, 12].reduce<RawPlan['weeks']>((acc) => acc, Array.from({ length: 12 }, (_, i) => ({
      week_index: i + 1, phase: 'build', planned_volume_km: 50, is_recovery_week: [4, 8, 10, 12].includes(i + 1),
      sessions: [{ sport: 'running', type: 'easy_run', assigned_day: 'day2', duration_minutes_target: 40 }],
    }))),
  };
  const text = renderExemplar(distillPlan(plan, 'nm'));
  expect(text).toContain('days are RELATIVE');
  expect(text).toContain('recovery/down weeks: 4, 8, 10, 12');
  expect(text).not.toContain('3:1');
});

// ------------------------------------------------------------ selection

const LIB: SelectableExemplar[] = [
  { sourceKey: 'carmel-33k', name: 'Carmel-Kinneret 33K', kind: 'full_plan', tags: ['trail', 'strength'], weeks: 31, goal: { distanceKm: 33, elevationGainM: 447, elevationLossM: 847 } },
  { sourceKey: 'carmel-55k', name: 'Carmel-Kinneret 55K', kind: 'full_plan', tags: ['trail', 'ultra', 'strength'], weeks: 31, goal: { distanceKm: 55, elevationGainM: 826, elevationLossM: 1240 } },
  { sourceKey: 'hm-pb', name: 'Half Marathon PB', kind: 'full_plan', tags: ['half-marathon', 'strength'], weeks: 10, goal: { distanceKm: 21.1, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'nor-hm', name: 'Norwegian Half', kind: 'full_plan', tags: ['threshold', 'half-marathon', 'strength'], weeks: 12, goal: { distanceKm: 21.1, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'nor-m', name: 'Norwegian Marathon', kind: 'full_plan', tags: ['threshold', 'marathon', 'strength'], weeks: 16, goal: { distanceKm: 42.2, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'tri', name: 'Half-Ironman', kind: 'multisport', tags: ['multisport'], weeks: 26, goal: { distanceKm: 113, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'comeback', name: 'Comeback Strong', kind: 'return_to_run', tags: ['return-to-run', 'strength'], weeks: 10, goal: { distanceKm: null, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'str-int', name: 'Intermediate Strength', kind: 'strength_block', tags: ['strength', 'strength-block'], weeks: 4, goal: { distanceKm: null, elevationGainM: null, elevationLossM: null } },
  { sourceKey: 'str-masters', name: 'Masters Strength', kind: 'strength_block', tags: ['masters', 'strength', 'strength-block'], weeks: 4, goal: { distanceKm: null, elevationGainM: null, elevationLossM: null } },
];

test("the athlete's race — 21K with 1300 m — draws on the TRAIL plans, not the flat halves of the same distance", () => {
  // Terrain dominates distance on purpose. A 21 km road-half plan matches the
  // distance exactly and is the wrong model for 61.9 m/km of climbing.
  const picked = selectExemplars(LIB, { planType: 'Trail / Mountain', raceDistanceKm: 21, raceElevationGainM: 1300 });
  expect(picked.map((e) => e.sourceKey)).toEqual(['carmel-33k', 'carmel-55k']);
});

test('a flat half marathon draws on the road half-marathon plans', () => {
  const picked = selectExemplars(LIB, { planType: 'Half Marathon', raceDistanceKm: 21.1 });
  expect(picked.every((e) => e.tags.includes('half-marathon'))).toBe(true);
  expect(picked.some((e) => e.tags.includes('trail'))).toBe(false);
});

test('triathlon and return-to-run plans stay out unless asked for', () => {
  const road = selectExemplars(LIB, { planType: 'Marathon', raceDistanceKm: 42.2 }, 9);
  expect(road.findIndex((e) => e.kind === 'multisport')).toBeGreaterThan(3);
  expect(scoreExemplar(LIB.find((e) => e.kind === 'multisport')!, { goalText: 'my first 70.3 triathlon' }))
    .toBeGreaterThan(scoreExemplar(LIB.find((e) => e.kind === 'multisport')!, { planType: 'Marathon' }));
  const injured = selectExemplars(LIB, { goalText: 'coming back from injury', raceDistanceKm: 10 }, 1);
  expect(injured[0].kind).toBe('return_to_run');
});

test('strength-only blocks are never chosen as a plan structure', () => {
  for (const req of [{ planType: 'Half Marathon' }, { planType: 'Trail / Mountain' }, { goalText: 'strength' }]) {
    expect(selectExemplars(LIB, req, 9).some((e) => e.kind === 'strength_block')).toBe(false);
  }
});

test('the strength reference switches to masters programming at 40', () => {
  expect(selectStrengthReference(LIB, 35)?.sourceKey).toBe('str-int');
  expect(selectStrengthReference(LIB, 44)?.sourceKey).toBe('str-masters');
  expect(selectStrengthReference(LIB, null)?.sourceKey).toBe('str-int');
  expect(selectStrengthReference(LIB.filter((e) => e.kind !== 'strength_block'), 44)).toBeNull();
});
