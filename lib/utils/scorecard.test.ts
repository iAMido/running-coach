/**
 * Run with `bun test`.
 *
 * The first assertion here is the load-bearing one and it is not about
 * correctness — it is about a decision that a future reader has every visual
 * incentive to reverse.
 */

import { expect, test } from 'bun:test';
import { buildScorecard, type ScorecardInput, type ScorecardRun } from '@/lib/utils/scorecard';
import type { ReadinessVerdict } from '@/lib/utils/readiness';

const GO: ReadinessVerdict = { verdict: 'GO', reasons: ['Fresh.'], usedRecoveryData: true };

function run(over: Partial<ScorecardRun> = {}): ScorecardRun {
  return {
    date: '2026-08-03',
    runType: 'Easy',
    zones: { pct_z1: 40, pct_z2: 45, pct_z3: 10, pct_z4: 5, pct_z5: 0, pct_z6: 0 },
    decouplingPct: 6.0,
    plannedTargetHr: 'Z1-Z2 (125-145)',
    plannedType: 'Easy Run',
    ...over,
  };
}

function card(over: Partial<ScorecardInput> = {}) {
  return buildScorecard({
    weekLabel: 'Week 9',
    weekStart: '2026-08-02',
    weekEnd: '2026-08-08',
    runs: [run()],
    readiness: GO,
    decouplingHistory: [2, 3, 4, 5, 6, 6.5, 7, 8, 9, 12, 15],
    ...over,
  });
}

test('the aerobic control row carries NO colour, and that is deliberate', () => {
  const row = card().rows.find((r) => r.key === 'aerobic_control')!;

  expect(row.colour).toBeNull();

  // If this assertion is failing because you gave the row a colour: don't.
  //
  // Decoupling here is GRADE-ADJUSTED (computed from per-lap gap_pace_min_km),
  // so Friel's <5 / 5-8 / >8 bands do not apply to it — those are defined on
  // raw Pa:HR and calibrated on other athletes. Measured on this athlete's own
  // 66 runs the median is 6.5%, with 25 runs above 8%: applying the bands would
  // label a third of his easy and long running "went too hard".
  //
  // The bands were deliberately kept out of the data layer. Colouring this row
  // reimports them through the presentation layer, where nobody can see the
  // decision being made. The row renders a percentile against his own history
  // instead, and the UI gives it a bar so it reads as a different KIND of row
  // rather than as a missing value.
  //
  // See docs/coach-analysis-gaps.md Part 6 and CLAUDE.md.
});

test('a colourless row always explains itself', () => {
  for (const row of card({ runs: [], readiness: null, decouplingHistory: [] }).rows) {
    if (row.colour === null) {
      expect(row.colourless.length).toBeGreaterThan(20);
    }
  }
});

test('an unmeasurable week is not a green week', () => {
  const zone = card({ runs: [run({ zones: null })] }).rows.find((r) => r.key === 'zone_discipline')!;
  expect(zone.colour).toBeNull();
  expect(zone.value).toBe('Not measurable');
});

test('zone discipline counts flags, not runs', () => {
  const onTarget = run();
  const tooHard = run({ zones: { pct_z1: 5, pct_z2: 10, pct_z3: 45, pct_z4: 40, pct_z5: 0, pct_z6: 0 } });

  expect(card({ runs: [onTarget, onTarget] }).rows[0].colour).toBe('good');
  expect(card({ runs: [onTarget, tooHard] }).rows[0].colour).toBe('warn');
  expect(card({ runs: [tooHard, tooHard] }).rows[0].colour).toBe('bad');
});

test('recovery mirrors the readiness verdict rather than inventing one', () => {
  const at = (v: ReadinessVerdict['verdict']) =>
    card({ readiness: { verdict: v, reasons: ['x'], usedRecoveryData: true } }).rows.find((r) => r.key === 'recovery')!.colour;

  expect(at('GO')).toBe('good');
  expect(at('EASY')).toBe('warn');
  expect(at('REST')).toBe('bad');
});

test('sample size travels with the card', () => {
  const c = card({ runs: [run(), run({ zones: null })] });
  expect(c.runCount).toBe(2);
  expect(c.runsWithZones).toBe(1);
});
