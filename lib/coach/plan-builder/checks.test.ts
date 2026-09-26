/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import type { PlanWeek, Workout } from '@/lib/db/types';
import { checkCoherence, checkPlan, inclineVertFromDescription, parseKm, parseTargetHr, type CheckContext } from './checks';
import type { PlanOutline } from './types';

const run = (type: string, km: number, extra: Partial<Workout> = {}): Workout =>
  ({ type, distance: `${km} km`, elevation_gain_m: 50, ...extra });

/** A clean 4-run week on Sun/Mon/Wed/Fri with Friday the long run. */
const week = (n: number, km: number, extra: Partial<PlanWeek> = {}, over: Record<string, Workout> = {}): PlanWeek => ({
  week_number: n, phase: 'Base', focus: 'aerobic', total_km: km, total_elevation_gain_m: 200,
  workouts: {
    Sunday: run('Easy Run', km * 0.2),
    Monday: run('Tempo', km * 0.25),
    Wednesday: run('Easy Run', km * 0.2, { strength: 'base' as never }),
    Friday: run('Long Run', km * 0.35),
    ...over,
  },
  ...extra,
});

const ctx: CheckContext = {
  expectedWeeks: 3, allowedDays: ['Sunday', 'Monday', 'Wednesday', 'Friday'], runsPerWeek: 4,
  hasElevation: true, hasRace: false, strengthLibrary: ['base'],
};
const rules = (v: { rule: string; severity: string }[], sev = 'error') => v.filter((x) => x.severity === sev).map((x) => x.rule);

test('parsers read the formats the model writes', () => {
  expect(parseKm('7 km')).toBe(7);
  expect(parseKm('10-12 km')).toBe(11);
  expect(parseKm('45 min')).toBeNull();
  expect(parseTargetHr('Z1-Z2 (120-140)')).toEqual({ zones: [1, 2], bpm: [120, 140] });
});

test('a clean, gently progressing plan has no errors', () => {
  expect(rules(checkPlan([week(1, 30), week(2, 32), week(3, 34)], ctx))).toEqual([]);
});

test('a run on a day he does not train is an error', () => {
  const v = checkPlan([week(1, 30, {}, { Tuesday: run('Easy Run', 5) }), week(2, 32), week(3, 34)], ctx);
  expect(rules(v)).toContain('training_days');
});

test('a 30% volume jump is an error; returning after a recovery week is not', () => {
  expect(rules(checkPlan([week(1, 30), week(2, 40), week(3, 40)], ctx))).toContain('volume_ramp');
  const recovery = checkPlan(
    [week(1, 34), week(2, 26, { focus: 'recovery week', total_elevation_gain_m: 120 }), week(3, 35)],
    ctx,
  );
  expect(rules(recovery)).not.toContain('volume_ramp');
});

test('a recovery week that is not lighter is caught', () => {
  const v = checkPlan([week(1, 30), week(2, 31, { focus: 'recovery' }), week(3, 32)], ctx);
  expect(rules(v)).toContain('recovery_is_lighter');
});

test('strength on the long-run day or the day before it is an error', () => {
  const onLong = week(1, 30, {}, { Friday: run('Long Run', 10, { strength: 'base' as never }) });
  expect(rules(checkPlan([onLong, week(2, 32), week(3, 34)], ctx))).toContain('strength_placement');
  const dayBefore = week(1, 30, {}, { Thursday: { type: 'Strength', strength: 'base' as never } as Workout });
  const v = checkPlan([dayBefore, week(2, 32), week(3, 34)], { ...ctx, allowedDays: null });
  expect(rules(v)).toContain('strength_placement');
});

test('an undefined strength id is an error, not a silent drop', () => {
  const w = week(1, 30, {}, { Wednesday: run('Easy Run', 6, { strength: 'ghost' as never }) });
  expect(rules(checkPlan([w, week(2, 32), week(3, 34)], ctx))).toContain('strength_reference');
});

test('missing weeks and missing climbing on an elevation plan are errors', () => {
  const v = checkPlan([week(1, 30), week(3, 34, { total_elevation_gain_m: null })], ctx);
  expect(rules(v)).toContain('weeks_complete');
  expect(rules(v)).toContain('elevation_present');
});

test('week 1 is judged against what he actually ran recently', () => {
  const v = checkPlan([week(1, 50), week(2, 50), week(3, 50)], { ...ctx, athlete: { recentWeeklyKm: 28, recentWeeklyVertM: 200 } });
  expect(rules(v)).toContain('start_volume');
});

test('a race week near peak volume fails the taper rule', () => {
  const v = checkPlan([week(1, 30), week(2, 32), week(3, 31)], { ...ctx, hasRace: true });
  expect(rules(v)).toContain('taper');
});

test('a zone label that disagrees with its own bpm is flagged', () => {
  const zones = { z1: { low: 0, high: 124 }, z2: { low: 124, high: 143 }, z3: { low: 143, high: 155 },
    z4: { low: 155, high: 168 }, z5: { low: 168, high: 181 }, z6: { low: 181, high: 191 } };
  const w = week(1, 30, {}, { Sunday: run('Easy Run', 6, { target_hr: 'Z1 (115-135)' }) });
  // 135 is 11 bpm into Z2: an error, repaired before saving.
  expect(rules(checkPlan([w, week(2, 32), week(3, 34)], { ...ctx, zones }))).toContain('hr_label');
  const near = week(1, 30, {}, { Sunday: run('Easy Run', 6, { target_hr: 'Z1 (110-128)' }) });
  expect(rules(checkPlan([near, week(2, 32), week(3, 34)], { ...ctx, zones }), 'warn')).toContain('hr_label');
});

const outline = (over: Partial<PlanOutline> = {}): PlanOutline => ({
  plan_name: 't', methodology: '', goal: '', rationale: '', sources: [], decisions: [],
  day_roles: { Monday: 'quality', Friday: 'long run' }, strength_sessions: {},
  phases: [
    { name: 'Base', start_week: 1, end_week: 2, purpose: '', key_sessions: [], strength_focus: '', exit_criteria: [] },
    { name: 'Build', start_week: 3, end_week: 3, purpose: '', key_sessions: [], strength_focus: '', exit_criteria: [] },
  ],
  weeks: [1, 2, 3].map((w) => ({ week: w, phase: w < 3 ? 'Base' : 'Build', focus: '', total_km: 30 + w * 2,
    total_elevation_gain_m: 200, long_run_km: 11, is_recovery: false, quality_sessions: 1, strength: ['base'] })),
  ...over,
});

test('coherence: a long run that leaps at a phase join is a must-fix', () => {
  const weeks = [week(1, 32), week(2, 34), week(3, 36, {}, { Friday: run('Long Run', 20) })];
  const issues = checkCoherence(weeks, outline(), { hasElevation: true });
  expect(issues.some((i) => i.severity === 'must_fix' && i.weeks.includes(3))).toBe(true);
});

test('coherence: a plan that never reaches the outline peak is a must-fix', () => {
  const weeks = [week(1, 20), week(2, 21), week(3, 22)];
  const issues = checkCoherence(weeks, outline(), { hasElevation: false });
  expect(issues.some((i) => /Peak volume/.test(i.problem))).toBe(true);
});

test('coherence: a recovery week with MORE strength than the week before is a must-fix', () => {
  const o = outline();
  o.weeks[1].is_recovery = true;
  const w2 = week(2, 26, {}, { Sunday: run('Easy Run', 6, { strength: 'base' as never }) });
  const issues = checkCoherence([week(1, 32), w2, week(3, 34)], o, { hasElevation: false });
  expect(issues.some((i) => /Recovery week 2/.test(i.problem))).toBe(true);
});

test('incline arithmetic reads the forms writers use, and ignores percentages that are not grades', () => {
  const v = inclineVertFromDescription;
  expect(v('WU 15min easy + BENCHMARK 20min at 10%/5.5km/h (~183m)')).toBe(183);
  expect(v('5x5 min @12% hike')).toBe(250); // default 5.0 km/h at 12%
  expect(v('30min steady Z2-Z3 RPE 2-3 | CD 10min')).toBeNull();
  expect(v('Easy 40min, 85% of runs easy')).toBeNull();
});

test('a treadmill session labelled far below what it climbs is an error', () => {
  const w = week(1, 30, {}, { Wednesday: run('Easy Run + Hike', 6, { elevation_gain_m: 18, description: '25min easy + 30min hike at 10-12%/5km/h' }) });
  const v = checkPlan([w, week(2, 32), week(3, 34)], ctx);
  expect(rules(v)).toContain('incline_vert_math');
});
