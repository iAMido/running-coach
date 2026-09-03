/**
 * Run with `bun test`.
 *
 * The load-bearing test is the first one: "no change" must be the ordinary
 * outcome. A loop that proposes every week trains the athlete to ignore it,
 * which is worse than not having the loop.
 */

import { expect, test } from 'bun:test';
import {
  ADHERENCE_FLOOR,
  evaluateTriggers,
  shouldPropose,
  describeNoChange,
  type Trigger,
} from '@/lib/coach/proposal-triggers';
import type { TrainingState } from '@/lib/coach/training-state';

function state(over: Partial<TrainingState> = {}): TrainingState {
  return {
    generatedAt: '2026-09-05T00:00:00Z',
    windowDays: 84,
    weeks: [
      { weekStart: '2026-08-09', isPartial: false, runs: 4, km: 30, vertM: 300, vertMeasuredRuns: 4, trimp: 200 },
      { weekStart: '2026-08-16', isPartial: false, runs: 4, km: 29, vertM: 290, vertMeasuredRuns: 4, trimp: 195 },
      { weekStart: '2026-08-23', isPartial: false, runs: 4, km: 31, vertM: 310, vertMeasuredRuns: 4, trimp: 205 },
      { weekStart: '2026-08-30', isPartial: false, runs: 4, km: 30, vertM: 300, vertMeasuredRuns: 4, trimp: 200 },
    ],
    volumeKm: { recent: 30.5, prior: 29.5, direction: 'flat', pctChange: 3.4 },
    vertM: { recent: 305, prior: 295, direction: 'flat', pctChange: 3.4 },
    adherence: {
      plannedDays: ['Sunday', 'Monday', 'Wednesday', 'Friday'],
      actualDayCounts: { Sunday: 4, Monday: 4, Tuesday: 0, Wednesday: 4, Thursday: 0, Friday: 4, Saturday: 0 },
      runsOnPlannedDays: 16, totalRuns: 16, rate: 1,
    },
    efficiency: { current: { median: 1.0, n: 12, from: '2026-07-01', to: '2026-09-01' }, seasonBaseline: null, pctVsBaseline: null, trend: [] },
    decoupling: { allTimeMedian: 6.8, recentMedian: 6.5, recentPercentile: 45, measuredRuns: 10 },
    load: { ctl: 20, atl: 18, form: 2 },
    readiness: null,
    climb: { measuredRuns: 16, medianVertPerKm: 9, maxVertPerKm: 12, maxGainM: 160, avgWeeklyGainM: 300 },
    activePlan: null,
    injuryHistory: null,
    gaps: [],
    ...over,
  };
}

test('an ordinary week proposes NOTHING', () => {
  // This is the property that matters most. If a normal week fires a trigger,
  // the thresholds are wrong and the loop becomes noise.
  const triggers = evaluateTriggers({ state: state(), phase: null, weeksIntoPhase: null });
  expect(triggers).toEqual([]);
  expect(shouldPropose(triggers)).toBe(false);
  expect(describeNoChange(triggers)).toContain('Nothing crossed a threshold');
});

test('one soft signal alone is not enough — two must agree', () => {
  const soft: Trigger[] = [{ code: 'low_adherence', detail: 'x', urgent: false }];
  expect(shouldPropose(soft)).toBe(false);

  const two: Trigger[] = [...soft, { code: 'efficiency_declining', detail: 'y', urgent: false }];
  expect(shouldPropose(two)).toBe(true);

  // An urgent signal stands on its own.
  expect(shouldPropose([{ code: 'ramp_too_fast', detail: 'z', urgent: true }])).toBe(true);
});

test('a runaway ramp fires on its own, and a normal build does not', () => {
  const ramp = evaluateTriggers({
    state: state({ volumeKm: { recent: 42, prior: 30, direction: 'rising', pctChange: 40 } }),
    phase: null, weeksIntoPhase: null,
  });
  expect(ramp.map((t) => t.code)).toContain('ramp_too_fast');
  expect(shouldPropose(ramp)).toBe(true);

  // A healthy 15% build must stay silent.
  const healthy = evaluateTriggers({
    state: state({ volumeKm: { recent: 34.5, prior: 30, direction: 'rising', pctChange: 15 } }),
    phase: null, weeksIntoPhase: null,
  });
  expect(healthy).toEqual([]);
});

test('unmeasured vert never fires the phase-floor trigger', () => {
  // Weeks with no elevation reading are unmeasured, not flat. Treating them as
  // 0 m would fire "below the phase floor" on missing data — the single most
  // repeated failure in this codebase's history.
  const noVert = state({
    weeks: state().weeks.map((w) => ({ ...w, vertM: null, vertMeasuredRuns: 0 })),
  });
  const t = evaluateTriggers({
    state: noVert,
    phase: {
      phase_number: 1, name: 'Base', focus: '', weeks: 8,
      weekly_km_range: [25, 35], weekly_vert_range_m: [500, 800],
      long_run_vert_ceiling_m: 400, capability: '', exit_criteria: [], key_sessions: [],
    },
    weeksIntoPhase: 3,
  });
  expect(t.map((x) => x.code)).not.toContain('vert_below_phase');
});

test('sustained vert below the phase floor does fire', () => {
  const t = evaluateTriggers({
    state: state(), // 300, 310 m in the last two weeks
    phase: {
      phase_number: 1, name: 'Gradient', focus: '', weeks: 8,
      weekly_km_range: [25, 35], weekly_vert_range_m: [500, 800],
      long_run_vert_ceiling_m: 400, capability: '', exit_criteria: [], key_sessions: [],
    },
    weeksIntoPhase: 3,
  });
  expect(t.map((x) => x.code)).toContain('vert_below_phase');
});

test('unset training days is a gap, never 0% adherence', () => {
  const t = evaluateTriggers({
    state: state({
      adherence: { plannedDays: null, actualDayCounts: {}, runsOnPlannedDays: 0, totalRuns: 16, rate: null },
    }),
    phase: null, weeksIntoPhase: null,
  });
  // rate === null must not be read as "below the floor".
  expect(t.map((x) => x.code)).not.toContain('low_adherence');
  expect(ADHERENCE_FLOOR).toBe(0.5);
});
