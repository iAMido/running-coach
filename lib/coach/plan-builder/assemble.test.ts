/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import { assemblePlan, chunksContaining, chunksFor, mergeStrength, mergeWeeks, normalizeOutline, parseWriterWeeks } from './assemble';
import type { BuildReport, PlanOutline } from './types';

const rawOutline = (weeks: number, over: Record<string, unknown> = {}) => ({
  plan_name: 'P', rationale: 'r', day_roles: { Monday: 'quality', Friday: 'long run', Tuesday: 'easy' },
  phases: [
    { name: 'Base', start_week: 1, end_week: Math.min(6, weeks) },
    ...(weeks > 6 ? [{ name: 'Build', start_week: 7, end_week: weeks }] : []),
  ],
  weeks: Array.from({ length: weeks }, (_, i) => ({
    week: i + 1, phase: i < 6 ? 'Base' : 'Build', total_km: 30 + i, total_elevation_gain_m: 200,
    long_run_km: 10, is_recovery: false, quality_sessions: 1, strength: ['base', 'ghost'],
  })),
  strength_sessions: { base: { name: 'B', exercises: [{ exercise: 'Squat', sets: 3 }] }, nameless: { exercises: [] } },
  ...over,
});
const opts = { durationWeeks: 8, allowedDays: ['Sunday', 'Monday', 'Wednesday', 'Friday'], hasElevation: true };

test('outline: repairs what it can and reports it', () => {
  const { outline, fatal, repaired } = normalizeOutline(rawOutline(8), opts);
  expect(fatal).toEqual([]);
  expect(outline!.weeks[0].strength).toEqual(['base']); // undefined id dropped
  expect(Object.keys(outline!.strength_sessions)).toEqual(['base']); // nameless session dropped
  expect(outline!.day_roles).toEqual({ Monday: 'quality', Friday: 'long run' }); // Tuesday not a training day
  expect(repaired.length).toBeGreaterThanOrEqual(3);
});

test('outline: a missing week or climbing target is fatal — writers cannot work from it', () => {
  expect(normalizeOutline(rawOutline(7), opts).fatal.some((f) => /week 8/.test(f))).toBe(true);
  const noVert = rawOutline(8);
  (noVert.weeks[2] as Record<string, unknown>).total_elevation_gain_m = null;
  expect(normalizeOutline(noVert, opts).outline).toBeNull();
});

test('chunks: never cross a phase, never exceed 4 weeks, split evenly', () => {
  const { outline } = normalizeOutline(rawOutline(8), opts);
  const chunks = chunksFor(outline!);
  expect(chunks.map((c) => c.weeks)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  expect(chunks.every((c) => c.weeks.length <= 4)).toBe(true);
  expect(chunksContaining(chunks, [5, 8]).map((c) => c.weeks[0])).toEqual([4, 7]);
});

test('writer output: must cover exactly its weeks; truncation is refused', () => {
  const chunk = { phase: 'Base', weeks: [1, 2] };
  const good = JSON.stringify({ weeks: [{ week_number: 1, total_km: 30, workouts: {} }, { week_number: 2, total_km: '32', workouts: {} }, { week_number: 9 }] });
  const r = parseWriterWeeks(good, chunk, 'stop');
  expect(r.ok && r.weeks.map((w) => [w.week_number, w.total_km, w.phase])).toEqual([[1, 30, 'Base'], [2, 32, 'Base']]);
  expect(parseWriterWeeks(JSON.stringify({ weeks: [{ week_number: 1 }] }), chunk).ok).toBe(false);
  expect(parseWriterWeeks(good, chunk, 'length').ok).toBe(false);
});

test('merge replaces by week number and keeps order', () => {
  const w = (n: number, km: number) => ({ week_number: n, phase: '', focus: '', total_km: km, workouts: {} });
  expect(mergeWeeks([w(1, 1), w(2, 2), w(3, 3)], [w(2, 20)]).map((x) => x.total_km)).toEqual([1, 20, 3]);
});

test('assembled plan expands strength references and carries the build report', () => {
  const { outline } = normalizeOutline(rawOutline(8), opts);
  const weeks = [{ week_number: 1, phase: 'Base', focus: '', total_km: 30,
    workouts: { Wednesday: { type: 'Easy Run', strength: 'base' as never } } }];
  const plan = assemblePlan(outline as PlanOutline, weeks, 8, { build_id: 'b' } as BuildReport);
  const wed = (plan.weeks as { workouts: { Wednesday: { strength: { name: string } } } }[])[0].workouts.Wednesday;
  expect(wed.strength.name).toBe('B');
  expect((plan.build_report as BuildReport).build_id).toBe('b');
  expect((plan.phase_structure as { base_weeks: number }).base_weeks).toBe(6);
});

test('strength: the outline names sessions, the writer fills exercises, and cannot add sessions', () => {
  const named = { a: { name: 'A', focus: 'f', exercises: [] }, b: { name: 'B', exercises: [] } };
  const { library, missing } = mergeStrength(named, { strength_sessions: {
    a: { exercises: [{ exercise: 'Step-down', sets: 3 }] },
    rogue: { name: 'R', exercises: [{ exercise: 'X', sets: 1 }] },
  } });
  expect(library.a.exercises.length).toBe(1);
  expect(library.a.focus).toBe('f');
  expect('rogue' in library).toBe(false);
  expect(missing).toEqual(['b']);
});
