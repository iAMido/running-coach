/**
 * Run with `bun test`. Built on the real 2026-11-08 recovery run, whose note
 * called avg HR 129 "Z3" and said "tomorrow's easy" before a hill session.
 */

import { expect, test } from 'bun:test';
import { buildRunFacts, checkNote, zoneOfHr, type RunReactionInput } from '@/lib/ai/run-reaction';
import type { ZoneBands } from '@/lib/utils/zones';

const BANDS: ZoneBands = {
  z1: { low: 0, high: 124 }, z2: { low: 124, high: 143 }, z3: { low: 143, high: 155 },
  z4: { low: 155, high: 168 }, z5: { low: 168, high: 181 }, z6: { low: 181, high: 191 },
};

const nov8: RunReactionInput = {
  distanceKm: 3.12, durationMin: 24.9, avgHr: 129, runType: 'Recovery',
  zonePercents: { z1: 22.2, z2: 75.8, z3: 2, z4: 0, z5: 0, z6: 0 },
  zoneBands: BANDS,
  plannedWorkout: { type: 'Recovery Run', duration: '25 min', target_hr: 'Z1 (110-124)' },
  tomorrow: { covered: true, dayName: 'Monday', workout: { type: 'Hill Repeats + Strength', duration: '35 min' } },
};

const REAL_NOTE = "You nailed the distance and stayed disciplined in Z2, but your average HR of 129 crept into Z3 territory—that's too high for recovery. Tomorrow's easy, so dial back the effort another five beats and let your system actually recover.";

test('zone edges belong to the zone above', () => {
  expect(zoneOfHr(129, BANDS)).toBe(2);
  expect(zoneOfHr(124, BANDS)).toBe(2);
  expect(zoneOfHr(123, BANDS)).toBe(1);
  expect(zoneOfHr(195, BANDS)).toBe(6);
});

test('the facts state the avg-HR zone, the gap to target and tomorrow', () => {
  const f = buildRunFacts(nov8);
  expect(f.text).toContain('Average HR 129 bpm — that is in HIS Z2.');
  expect(f.text).toContain('5 bpm ABOVE the top of the target');
  expect(f.text).toContain('Tomorrow (Monday): Hill Repeats + Strength');
  expect(f.tomorrow).toBe('quality');
});

test('the real 2026-11-08 note is rejected for both mistakes', () => {
  const problems = checkNote(REAL_NOTE, buildRunFacts(nov8));
  expect(problems.some((p) => p.includes('Z3'))).toBe(true);
  expect(problems.some((p) => p.includes('tomorrow is a quality session'))).toBe(true);
});

test('a correct note passes', () => {
  const ok = 'Steady 3.1 km at 129 bpm, mostly Z2 — five beats above the recovery target. Keep tomorrow\'s hill reps sharp by starting the warm-up truly easy.';
  expect(checkNote(ok, buildRunFacts(nov8))).toEqual([]);
});

test('unknown tomorrow may not be mentioned; no bands, no zone names', () => {
  const f = buildRunFacts({ ...nov8, zoneBands: null, zonePercents: null, plannedWorkout: null, tomorrow: null });
  expect(f.text).toContain('do NOT mention tomorrow');
  const p = checkNote('Easy 3.1 km in Z2. Tomorrow rest.', f);
  expect(p.some((x) => x.includes('Z2'))).toBe(true);
  expect(p.some((x) => x.includes('not known'))).toBe(true);
});

test('a rest day tomorrow cannot be given a session', () => {
  const f = buildRunFacts({ ...nov8, tomorrow: { covered: true, dayName: 'Tuesday', workout: null } });
  expect(f.tomorrow).toBe('rest');
  expect(checkNote('Solid 3.1 km. Tomorrow\'s session is a tempo, so sleep well.', f).length).toBe(1);
  expect(checkNote('Solid 3.1 km at 129 bpm. Tomorrow is a rest day — use it.', f)).toEqual([]);
});

// The real 2026-11-09 hill session: 138 avg inside a 130-155 target, rest day next.
const nov9: RunReactionInput = {
  distanceKm: 4.98, durationMin: 37.3, avgHr: 138, runType: 'Intervals',
  zonePercents: { z1: 8.4, z2: 57.6, z3: 23.4, z4: 10.3, z5: 0, z6: 0 },
  zoneBands: BANDS,
  plannedWorkout: { type: 'Hill Repeats + Strength', duration: '35 min', target_hr: 'Z2-Z3 (130-155)' },
  tomorrow: { covered: true, dayName: 'Tuesday', workout: null },
};
const NOV9_NOTE = 'You ran 5km at 7:29/km with 138 avg HR, but stayed too conservative in Z2—you needed sharper Z4 work to hit those hill repeats. Tomorrow, commit to the intensity: trust the plan and push the climbs harder.';

test('the verdict is decided in code and stated', () => {
  const f = buildRunFacts(nov9);
  expect(f.verdict).toBe('on_target');
  expect(f.text).toContain('VERDICT: effort was ON TARGET');
  expect(buildRunFacts(nov8).verdict).toBe('above');
  expect(buildRunFacts({ ...nov9, plannedWorkout: null }).verdict).toBe('unknown');
});

test('the real 2026-11-09 note is rejected: push-harder on target, and a session on a rest day', () => {
  const p = checkNote(NOV9_NOTE, buildRunFacts(nov9));
  expect(p.some((x) => x.includes('asks for more intensity'))).toBe(true);
  expect(p.some((x) => x.includes('rest day'))).toBe(true);
});

test('an on-target note passes; too-hard on target fails', () => {
  const f = buildRunFacts(nov9);
  expect(checkNote('Solid 5 km of hill reps at 138 bpm, right inside the 130-155 target. Tomorrow is a rest day — use it.', f)).toEqual([]);
  expect(checkNote('5 km at 138 bpm, but that was too hard for the day.', f).length).toBe(1);
});

test('above target: easing off is fine, pushing is not', () => {
  const f = buildRunFacts(nov8);
  expect(checkNote('3.1 km at 129 bpm, five beats over the recovery ceiling — ease off on the next recovery run.', f)).toEqual([]);
  expect(checkNote('3.1 km at 129 bpm. Push harder next time.', f).length).toBe(1);
});
