/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import type { MacroPhase } from '@/lib/coach/macro-plan';
import { checkSeason, normalizeSeason, type SeasonCheckContext } from './season-checks';
import type { SeasonDraft } from './types';

const phase = (n: number, name: string, weeks: number, km: [number, number], vert: [number, number] | null, extra: Partial<MacroPhase> = {}): MacroPhase => ({
  phase_number: n, name, focus: '', weeks, weekly_km_range: km, weekly_vert_range_m: vert,
  long_run_vert_ceiling_m: null, capability: '', key_sessions: [],
  exit_criteria: ['3 consecutive weeks at 400+ m vert', 'long run 2 h with decoupling at or below his own median'],
  ...extra,
});

/** A sound 40-week mountain season ending on race week. */
const good = (): SeasonDraft => ({
  goal_name: 'Mountain half', rationale: 'Poles enter in Specific.', decisions: ['Poles: yes, from phase 3'],
  phases: [
    phase(1, 'Base', 12, [25, 32], [200, 400]),
    phase(2, 'Build', 12, [30, 38], [400, 800]),
    phase(3, 'Specific', 12, [34, 42], [800, 1500]),
    phase(4, 'Taper', 4, [22, 30], [400, 800], { exit_criteria: ['race day'] }),
  ],
});
const ctx: SeasonCheckContext = {
  horizonWeeks: 40, weeksToRace: 40, hasElevation: true, raceElevationGainM: 1300, vertPerKm: 61.9,
  raceDistanceKm: 21, athlete: { recentWeeklyKm: 25, recentWeeklyVertM: 198 },
};
const errs = (s: SeasonDraft, c = ctx) => checkSeason(s, c).filter((v) => v.severity === 'error').map((v) => v.rule);

test('a sound season passes', () => {
  expect(errs(good())).toEqual([]);
});

test('phases must cover the season and end on race week with a taper', () => {
  const s = good();
  s.phases[2].weeks = 6;
  expect(errs(s)).toContain('season_length');
  const noTaper = good();
  noTaper.phases[3] = phase(4, 'Peak', 4, [34, 42], [800, 1500]);
  expect(errs(noTaper)).toContain('season_taper');
});

test('a season ending before the race needs no taper', () => {
  const s = good();
  s.phases.pop();
  s.phases[2].weeks = 12;
  expect(errs(s, { ...ctx, horizonWeeks: 36, weeksToRace: 40 })).toEqual([]);
});

test('it must start from his measured load and never leap between phases', () => {
  const s = good();
  s.phases[0].weekly_km_range = [45, 55];
  expect(errs(s)).toContain('season_start_km');
  const vert = good();
  vert.phases[0].weekly_vert_range_m = [300, 450]; // +52% on his measured 198 m
  expect(errs(vert)).toContain('season_start_vert');
  const leap = good();
  leap.phases[1].weekly_vert_range_m = [900, 1200];
  expect(errs(leap)).toContain('phase_jump_vert');
});

test('it must train at least one race-sized climbing week', () => {
  const s = good();
  s.phases[2].weekly_vert_range_m = [800, 1000];
  expect(errs(s)).toContain('reaches_race_vert');
});

test('steep races need an explicit poles decision; absolute decoupling bands are refused', () => {
  const s = good();
  s.rationale = ''; s.decisions = [];
  expect(errs(s)).toContain('poles_decision');
  const d = good();
  d.phases[0].exit_criteria = ['decoupling below 5% on long runs'];
  expect(errs(d)).toContain('absolute_decoupling');
});

test('normalize: renumbers phases, refuses a season with no usable phases', () => {
  const { season } = normalizeSeason({ phases: [{ name: 'A', weeks: 4, weekly_km_range: [20, 25] }, { name: 'B', weeks: '6' }] }, 'G');
  expect(season!.phases.map((p) => [p.phase_number, p.weeks])).toEqual([[1, 4], [2, 6]]);
  expect(season!.goal_name).toBe('G');
  expect(normalizeSeason({ phases: [] }, 'G').season).toBeNull();
});
