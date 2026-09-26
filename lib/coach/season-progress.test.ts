/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import type { MacroPhase, MacroPlan, PhaseKpi, PhaseProgress } from '@/lib/coach/macro-plan';
import { currentPhase, raceSlackWeeks, recommend, timelineOf } from './season-progress';
import { evaluateKpis, type KpiData } from './phase-kpis';

const phase = (n: number, weeks: number): MacroPhase => ({
  phase_number: n, name: `P${n}`, focus: '', weeks, weekly_km_range: [20, 30], weekly_vert_range_m: [200, 400],
  long_run_vert_ceiling_m: null, capability: '', exit_criteria: [], key_sessions: [],
});
const progress = (n: number, over: Partial<PhaseProgress> = {}): PhaseProgress =>
  ({ phase_number: n, status: 'planned', start_date: null, extension_weeks: 0, plan_ids: [], ended_on: null, ...over });
const season = (over: Partial<MacroPlan> = {}) => ({
  phases: [phase(1, 6), phase(2, 10), phase(3, 4)], start_date: '2026-09-27', created_at: '2026-09-26T10:00:00Z',
  race_date: '2027-02-13', phase_progress: [progress(1), progress(2), progress(3)], ...over,
}) as MacroPlan;

test('timeline: actual start and extensions push every later phase', () => {
  const s = season({ phase_progress: [progress(1, { status: 'active', start_date: '2026-10-04', extension_weeks: 2, plan_ids: ['a'] }), progress(2), progress(3)] });
  const t = timelineOf(s);
  expect(t[0].start).toBe('2026-10-04');
  expect(t[0].weeks).toBe(8);
  expect(t[1].start).toBe('2026-11-29'); // 8 weeks after Oct 4
  expect(raceSlackWeeks(season())).toBe(0); // 20 weeks fit exactly
  expect(raceSlackWeeks(s)).toBeLessThan(0); // late start + extension overrun race day
});

test('current phase: not started until phase 1 is built; then by its real start', () => {
  expect(currentPhase(season(), '2026-10-10')!.weekOfPhase).toBeNull();
  const s = season({ phase_progress: [progress(1, { status: 'active', start_date: '2026-09-27', plan_ids: ['a'] }), progress(2), progress(3)] });
  const c = currentPhase(s, '2026-10-26')!; // Monday of week 5
  expect(c.entry.phase.phase_number).toBe(1);
  expect(c.weekOfPhase).toBe(5);
  expect(c.weeksLeft).toBe(2);
});

const kpi = (over: Partial<PhaseKpi>): PhaseKpi => ({ id: 'k', label: 'k', metric: 'weekly_km', comparator: 'gte', target: 30, ...over });
const run = (date: string, km: number, vert: number | null = 100) => ({ date, distance_km: km, elevation_gain_m: vert, decoupling_pct: null });
const data = (runs: KpiData['runs']): KpiData => ({ today: '2026-10-28', runs, decouplingHistory: [], trainingDays: ['Sunday', 'Monday'], ctl: 22, form: -4 });

test('KPIs: consecutive complete weeks; the week in progress never counts', () => {
  const runs = [run('2026-10-04', 31), run('2026-10-11', 32), run('2026-10-18', 33), run('2026-10-26', 40)];
  const [s] = evaluateKpis([kpi({ consecutive_weeks: 3 })], data(runs));
  expect(s.met).toBe(true);
  expect(s.current).toBe(33); // Oct 25 week is in progress on the 28th
  const [s2] = evaluateKpis([kpi({ consecutive_weeks: 3 })], data([run('2026-10-04', 31), run('2026-10-11', 20), run('2026-10-18', 33)]));
  expect(s2.met).toBe(false);
});

test('KPIs: unmeasured climbing is null, never zero; session and adherence metrics', () => {
  const [v] = evaluateKpis([kpi({ metric: 'weekly_vert_m', target: 300 })], data([run('2026-10-04', 8, null)]));
  expect(v.current).toBeNull();
  const [s] = evaluateKpis([kpi({ metric: 'session_vert_m', target: 400 })], data([run('2026-10-04', 8, 250), run('2026-10-11', 12, 420)]));
  expect(s.met).toBe(true);
  const [a] = evaluateKpis([kpi({ metric: 'adherence_pct', target: 75 })], data([run('2026-10-04', 8), run('2026-10-06', 8)]));
  expect(a.current).toBe(50); // Sunday on, Tuesday off
});

const active = () => currentPhase(season({ phase_progress: [progress(1, { status: 'active', start_date: '2026-09-27', plan_ids: ['a'] }), progress(2), progress(3)] }), '2026-10-26')!;
const status = (met: boolean, current: number | null, target = 30, trend: 'up' | null = null) =>
  ({ kpi: kpi({ target, label: `t${target}` }), met, current, trend, detail: '' });

test('recommend: last 2 weeks decide — all met, one close gap, or extend', () => {
  const opts = { isLastPhase: false, readiness: 'GO' as const, raceSlackWeeks: 4 };
  expect(recommend(active(), [status(true, 32)], opts).kind).toBe('build_next');
  expect(recommend(active(), [status(true, 32), status(false, 28)], opts).kind).toBe('advance_with_gap');
  const ext = recommend(active(), [status(false, 20), status(false, 15, 40)], opts);
  expect(ext.kind).toBe('extend');
  // Not enough slack before race day: extending would eat the taper.
  expect(recommend(active(), [status(false, 20), status(false, 15, 40)], { ...opts, raceSlackWeeks: 1 }).kind).toBe('advance_with_gap');
});

test('recommend: before the last 2 weeks it is only a progress report, unless everything is met', () => {
  const early = { ...active(), weekOfPhase: 2, weeksLeft: 5 };
  const opts = { isLastPhase: false, readiness: 'GO' as const, raceSlackWeeks: 4 };
  expect(recommend(early, [status(false, 20)], opts).kind).toBe('on_track');
  expect(recommend(early, [status(true, 32)], opts).kind).toBe('build_next');
  // An unmeasured KPI is never a pass.
  expect(recommend(early, [status(false, null)], opts).kind).toBe('on_track');
});
