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
    elevationGainM: 80,
    plannedElevationGainM: null,
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

test('a verdict covering a minority of the week takes no colour', () => {
  const judged = run();
  const unjudgeable = run({ plannedTargetHr: null, plannedType: null });

  // 1 of 3 judged: this is the real Week 9 shape, and it took a green tick
  // before the coverage gate existed. A green glyph is what the eye takes.
  const thin = card({ runs: [judged, unjudgeable, unjudgeable] }).rows[0];
  expect(thin.colour).toBeNull();
  expect(thin.value).toBe('1 of 3 runs judged · all on target');

  // 2 of 3 clears half, so the verdict describes most of the week.
  expect(card({ runs: [judged, judged, unjudgeable] }).rows[0].colour).toBe('good');

  // A single judged run is FULLY covered — coverage is what is being tested,
  // not sample size, so this must keep its colour.
  expect(card({ runs: [judged] }).rows[0].colour).toBe('good');
});

test('coverage leads the value, not the small print', () => {
  expect(card({ runs: [run(), run()] }).rows[0].value).toBe('2 of 2 runs judged · all on target');
});

test('the percentile carries the spread its sample supports', () => {
  const history = Array.from({ length: 20 }, (_, i) => i);
  const one = card({ runs: [run({ decouplingPct: 10 })], decouplingHistory: history })
    .rows.find((r) => r.key === 'aerobic_control')!;
  expect(one.sampleCount).toBe(1);
  expect(one.percentileLow).toBe(one.percentileHigh);

  const two = card({ runs: [run({ decouplingPct: 2 }), run({ decouplingPct: 18 })], decouplingHistory: history })
    .rows.find((r) => r.key === 'aerobic_control')!;
  expect(two.percentileLow!).toBeLessThan(two.percentileHigh!);
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

test('the climb row withholds a verdict when nothing says what the climb should be', () => {
  // 80 m is neither good nor bad on its own. Without a prescribed target or an
  // active phase band there is nothing to judge it against, and inventing one
  // is what the whole card refuses to do.
  const row = card().rows.find((r) => r.key === 'climb')!;
  expect(row.colour).toBeNull();
  expect(row.value).toContain('80 m');
  expect('colourless' in row && row.colourless).toContain('no weekly climb target');
});

test('unmeasured climb is never scored as zero', () => {
  // A week with no elevation readings must say so. Reporting 0 m and colouring
  // it red would score the athlete on missing data.
  const row = card({ runs: [run({ elevationGainM: null })] }).rows.find((r) => r.key === 'climb')!;
  expect(row.colour).toBeNull();
  expect(row.value).toBe('Not measured');
  expect(row.detail).toContain('not flat terrain');
});

test('a prescribed climb target is what the week is judged against', () => {
  const onTarget = card({
    runs: [run({ elevationGainM: 400, plannedElevationGainM: 400 })],
  }).rows.find((r) => r.key === 'climb')!;
  expect(onTarget.colour).toBe('good');
  expect(onTarget.value).toBe('400 m of 400 m');

  const wellShort = card({
    runs: [run({ elevationGainM: 100, plannedElevationGainM: 400 })],
  }).rows.find((r) => r.key === 'climb')!;
  expect(wellShort.colour).toBe('bad');
});

test('the phase band judges a week the plan did not prescribe vert for', () => {
  const inBand = card({
    runs: [run({ elevationGainM: 600 })],
    phaseVertRangeM: [500, 800],
  }).rows.find((r) => r.key === 'climb')!;
  expect(inBand.colour).toBe('good');
  expect(inBand.detail).toContain('500-800 m/week');
});

test('a partial week says its total is a floor', () => {
  const row = card({
    runs: [run({ elevationGainM: 300 }), run({ elevationGainM: null })],
  }).rows.find((r) => r.key === 'climb')!;
  expect(row.detail).toContain('floor');
  expect(row.value).toContain('300 m');
});
