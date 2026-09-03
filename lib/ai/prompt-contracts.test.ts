/**
 * Run with `bun test`.
 *
 * ## What these are for
 *
 * Every serious bug found in this codebase's prompt layer has been the same
 * shape: **a hardcoded value rendered as if it were measured fact.** It reads
 * plausibly, so no one checks it, and it survives for months.
 *
 * Found so far, all of them this way:
 *   - "Monday/Wednesday/Friday" day anchors in FIVE places, two of which sat
 *     after the real training-days parameter and silently overrode it
 *   - "sub-2hr HM goal = 5:40/km race pace", asserted for every athlete and
 *     every goal, and wrong by 27 s/km even for the one it named
 *   - `training_days: 'Mon, Wed, Fri'` seeded into every new profile
 *   - a 185 max HR and its zone bands — this athlete's SUPERSEDED definition
 *
 * These tests assert the contract rather than any one instance: build the real
 * prompts and check that forbidden literals are absent and required
 * disclaimers are present. A future hardcoded default fails here instead of
 * quietly shaping training for a season.
 */

import { expect, test } from 'bun:test';
import {
  ADJUSTMENT_WINDOW_WEEKS,
  COACH_STATIC_BLOCK,
  buildCoachSystemPrompt,
  buildPlanAdjustmentPrompt,
  buildRaceDemandBlock,
} from '@/lib/ai/coach-prompts';
import { CLIMB_BANDS } from '@/lib/utils/elevation';
import type { AthleteProfile } from '@/lib/db/types';

/** A profile with NOTHING set — the case where fallbacks used to fire. */
const EMPTY_PROFILE = {} as AthleteProfile;

/**
 * Values that must never appear in a prompt built from an empty profile.
 * Each one is a real bug that shipped.
 */
const FORBIDDEN_DEFAULTS: [string, string][] = [
  ['5:40', 'a frozen race pace, wrong even for the goal it claimed'],
  ['sub-2hr', 'a goal the athlete never set'],
  ['Sub-2hr Half Marathon', 'a goal the athlete never set'],
  ['Mon, Wed, Fri', 'invented training days'],
  ['**Monday**: Quality work', 'a hardcoded day anchor that overrode the real one'],
  ['0-120', 'a superseded HR zone band (max 185, replaced by 191)'],
  ['170-185', 'a superseded HR zone band'],
];

test('an empty profile produces no invented facts', () => {
  const prompt = buildCoachSystemPrompt({ profile: EMPTY_PROFILE });
  for (const [literal, why] of FORBIDDEN_DEFAULTS) {
    expect(prompt.includes(literal), `${literal} — ${why}`).toBe(false);
  }
});

test('an empty profile says so, rather than staying silent', () => {
  // Absence has to be VISIBLE. A prompt that simply omits the zones reads as
  // though zones were not relevant, not as though they are unknown.
  const prompt = buildCoachSystemPrompt({ profile: EMPTY_PROFILE });
  expect(prompt).toContain('not set');
  expect(prompt).toContain('Do NOT assume one');
  expect(prompt).toContain('Zones are NOT SET');
});

test('the static block never hardcodes a weekly shape', () => {
  // COACH_STATIC_BLOCK is byte-stable and cached, so anything wrong in it is
  // wrong for every request on every surface at once.
  for (const [literal] of FORBIDDEN_DEFAULTS) {
    expect(COACH_STATIC_BLOCK.includes(literal)).toBe(false);
  }
  // It must instead point at the supplied days.
  expect(COACH_STATIC_BLOCK).toContain('supplied per request');
  // And name the Israeli week, which a model otherwise gets backwards.
  expect(COACH_STATIC_BLOCK).toContain('Sunday is a WORKDAY');
});

test('the static block carries the standing rules every surface depends on', () => {
  // These reach chat, plan generation and adjustment only because they live
  // here. Moving any of them into a single builder silently drops it from the
  // other two — which is exactly how the Tier-3 rule was once lost.
  expect(COACH_STATIC_BLOCK).toContain('INDOOR ALTERNATIVE');
  expect(COACH_STATIC_BLOCK).toContain('Elevation');
  expect(COACH_STATIC_BLOCK).toContain('Decoupling');
  expect(COACH_STATIC_BLOCK).toContain('SHOW THE NUMBER YOU USED');
});

// ---------------------------------------------------------------- adjustment

function adjustPrompt(over: Partial<Parameters<typeof buildPlanAdjustmentPrompt>[0]> = {}) {
  return buildPlanAdjustmentPrompt({
    currentPlan: { weeks: [] },
    currentWeek: 3,
    adjustmentType: 'user_request',
    userRequest: 'Move my long run to Saturday',
    trainingDays: 'Sunday, Monday, Wednesday, Friday',
    ...over,
  });
}

test('an adjustment is told the training days, as a hard constraint', () => {
  // The prompt used to invite "Move hard sessions to different days" with no
  // constraint at all, so "move my long run" could land on a day he never
  // runs — which then reads as a missed session forever after.
  const p = adjustPrompt();
  expect(p).toContain('TRAINING DAYS — HARD CONSTRAINT');
  expect(p).toContain('Sunday, Monday, Wednesday, Friday');
  expect(p).toContain('Schedule ONLY on these days');
  expect(p).toContain("the athlete's OWN training days");
});

test('an adjustment with no days on file refuses to invent them', () => {
  const p = adjustPrompt({ trainingDays: null });
  expect(p).toContain('NOT SET');
  expect(p).toContain('do not invent a schedule');
});

test('an adjustment is bounded, not a whole-plan rewrite', () => {
  // "Generate workouts for ALL remaining weeks" at week 1 of a 16-week plan is
  // ~10k output tokens against an 8k cap: the response truncates, adjusted_weeks
  // comes back short, and the merge writes a partial plan with nothing
  // reporting a problem.
  const p = adjustPrompt({ currentWeek: 1 });
  expect(p).toContain(`weeks 1 to ${ADJUSTMENT_WINDOW_WEEKS}`);
  expect(p).not.toContain('ALL remaining weeks');
  expect(p).toContain('SMALLEST change');
});

test('an adjustment is told to preserve the fields it does not understand', () => {
  // An adjustment rewrites whole weeks. Any field missing from its output
  // example is a field it silently deletes.
  const p = adjustPrompt();
  expect(p).toContain('elevation_gain_m');
  expect(p).toContain('indoor_alternative');
  expect(p).toContain('total_elevation_gain_m');
  expect(p).toContain('PRESERVE every field');
});

test('an adjustment defers to the books rather than asserting a methodology', () => {
  const p = adjustPrompt();
  expect(p).toContain('the Triphasic\n  structure is the default, not an override');
});

// ------------------------------------------------------------- race fitting

test('the race demand block is silent without a race profile', () => {
  // A road plan must be completely unaffected by the elevation machinery.
  expect(buildRaceDemandBlock(undefined)).toBe('');
  expect(buildRaceDemandBlock({ distanceKm: 21 })).toBe('');
});

test('a race with elevation drives the plan, and says by how much', () => {
  const block = buildRaceDemandBlock({
    distanceKm: 21,
    elevationGainM: 1300,
    climb: { measuredRuns: 58, medianVertPerKm: 9.1, maxVertPerKm: 12.7, maxGainM: 160, avgWeeklyGainM: 197 },
  });
  expect(block).toContain('61.9 m/km');
  // The gap stated as a multiple of HIS history, not an abstract judgement.
  expect(block).toContain('4.9x his steepest run ever');
  expect(block).toContain('gradient as the limiter');
});

test('the static block quotes the SAME climb bands the code uses', () => {
  // Found by these tests. COACH_STATIC_BLOCK still described the pre-
  // calibration bands (Rolling 5-12, Hilly 12-25) after CLIMB_BANDS moved to
  // 5-15 / 15-25 — so the coach would have called a 13 m/km run "Hilly" while
  // every rendered badge called it "Rolling". Prose and constant drifting
  // apart is invisible until someone reads both, which is what this does.
  const hilly = CLIMB_BANDS.find((b) => b.category === 'Hilly')!.minVertPerKm;
  const rolling = CLIMB_BANDS.find((b) => b.category === 'Rolling')!.minVertPerKm;
  const mountain = CLIMB_BANDS.find((b) => b.category === 'Mountain')!.minVertPerKm;

  expect(COACH_STATIC_BLOCK).toContain(`Rolling ${rolling}-${hilly}`);
  expect(COACH_STATIC_BLOCK).toContain(`Hilly ${hilly}-${mountain}`);
  expect(COACH_STATIC_BLOCK).toContain(`Mountain ${mountain}+`);
});

test('the static block does not hardcode a multiple that drifts', () => {
  // The "3x his steepest" figure was computed all-time; the formatter now
  // reports it from a 120-day window, where it is 4.9x. A number stated in
  // both places will disagree with itself the moment either window moves.
  expect(COACH_STATIC_BLOCK).not.toContain('about 3x his steepest');
  expect(COACH_STATIC_BLOCK).toContain('cite THAT number rather than one you remember');
});

test('the race block reasons about the event, not just its numbers', () => {
  // The athlete asked for a coach that UNDERSTANDS the race: that 1300 m over
  // 21 km is a different event from a hilly half, that power-hiking is the
  // primary technique rather than a failure state, and that flat coastal
  // terrain cannot produce the load.
  const block = buildRaceDemandBlock({
    distanceKm: 21,
    elevationGainM: 1300,
    terrainAccess: 'Flat coastal plain; gym treadmill',
    climb: { measuredRuns: 58, medianVertPerKm: 9.1, maxVertPerKm: 12.7, maxGainM: 160, avgWeeklyGainM: 197 },
  });

  expect(block).toContain('average grade of 6.2%');
  expect(block).toContain('not a hilly half marathon');
  expect(block).toContain('does not transfer');
  expect(block).toContain('PRIMARY technique');
  expect(block).toContain('past aerobic threshold');
  expect(block).toContain('concentric');
  expect(block).toContain('eccentric');
  // Indoor vert must be prescribable, with the arithmetic supplied.
  expect(block).toContain('12% at 5 km/h');
  expect(block).toContain('600 m/hour');
  expect(block).toContain('do not report incline to the watch');
});

test('a shallow race does not get the power-hiking directive', () => {
  // 250 m over 21 km is 1.2% — a rolling road half. Telling that athlete to
  // power-hike would be nonsense, so the directive is gated on grade.
  const shallow = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 250 });
  expect(shallow).toContain('average grade of 1.2%');
  expect(shallow).not.toContain('PRIMARY technique');
});

test('gear decisions name their owner instead of being conditional', () => {
  // "If poles are appropriate, say which week they enter" was unanswerable at
  // block level — a 12-week Base block that is weeks 1-12 of 43 cannot
  // schedule week 30 — so the model correctly ignored it, which looked
  // identical to forgetting. An unstated decision and a decision made against
  // are different outcomes, and only one is recoverable later.
  const block = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 1300 });
  expect(block).toContain('SEASON-level decision and must never be left unstated');
  expect(block).toContain('exit criterion');
  expect(block).not.toContain('If poles are appropriate');
});
