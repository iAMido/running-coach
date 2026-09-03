/**
 * Run with `bun test`.
 *
 * The first test is the bug this file exists for.
 */

import { expect, test } from 'bun:test';
import { TERRAIN_WITHOUT_FLAT_PACE, formatGoalPaceBlock, formatPaceMinKm, goalPace, parseGoalMinutes } from '@/lib/utils/goal-pace';

test('the athletes real goal gives his real pace, not the hardcoded 5:40', () => {
  // The prompt asserted "sub-2hr HM goal = 5:40/km" for every athlete and
  // every goal. His stated goal is 1:50, which is 5:13/km — 27 s/km out, enough
  // to shift every derived training pace into the wrong zone.
  const g = goalPace('Secondary, unchanged: 1:50 half marathon')!;
  expect(g.distanceLabel).toBe('half marathon');
  expect(formatPaceMinKm(g.paceMinKm)).toBe('5:13');
  expect(formatPaceMinKm(g.paceMinKm)).not.toBe('5:40');
});

test('an unparseable goal yields NO pace block, never a default', () => {
  // A mountain race has no meaningful flat race pace. Saying so is useful;
  // substituting 5:40/km is the original bug.
  expect(goalPace('21K trail race, 1300m elevation gain')).toBeNull();
  expect(goalPace('Build climbing capacity for the mountain race')).toBeNull();
  expect(goalPace(null)).toBeNull();
  expect(goalPace('')).toBeNull();

  const block = formatGoalPaceBlock(null);
  expect(block).toContain('Do NOT assume one');
  expect(block).not.toContain('5:40');
});

test('common goal spellings parse', () => {
  expect(formatPaceMinKm(goalPace('sub 2hr half marathon')!.paceMinKm)).toBe('5:41');
  expect(formatPaceMinKm(goalPace('1:50:00 HM')!.paceMinKm)).toBe('5:13');
  expect(formatPaceMinKm(goalPace('marathon in 4:00')!.paceMinKm)).toBe('5:41');
  expect(formatPaceMinKm(goalPace('10K', '52:00')!.paceMinKm)).toBe('5:12');
});

test('h:mm vs mm:ss is resolved by what is physically plausible', () => {
  // "52:00" over 10K is 52 minutes. Read as 52 hours it would be absurd.
  expect(parseGoalMinutes('52:00', 10)).toBeCloseTo(52, 1);
  // "1:50" over a half is 1h50, not 1min50.
  expect(parseGoalMinutes('1:50', 21.0975)).toBeCloseTo(110, 1);
});

test('an implausible pace is treated as a failed parse', () => {
  // Better to report no target than a number nobody could run.
  expect(goalPace('half marathon in 0:30')).toBeNull();
  expect(goalPace('5K in 9:00:00')).toBeNull();
});

test('the derived block shows its work and disclaims steep terrain', () => {
  const block = formatGoalPaceBlock(goalPace('1:50 half marathon'));
  expect(block).toContain("derived from the athlete's own goal");
  expect(block).toContain('5:13');
  // Race pace is meaningless on a climb, and the block says so.
  expect(block).toContain('steep terrain they do not apply');
});

test('a trail 21K does not borrow the road half-marathon target', () => {
  // Found by probing the real profile. "21K trail race, 1300m gain" matched the
  // half-marathon DISTANCE pattern on "21K", then picked up the 1:50 from the
  // athlete's secondary ROAD goal held in the same field — producing a
  // confident 5:13/km road pace for a mountain race. Distance alone does not
  // identify a race.
  expect(
    goalPace(
      '21K trail race, 1300m gain (61.9 m/km avg) on 2027-07-03. Secondary, unchanged: 1:50 half marathon.',
    ),
  ).toBeNull();

  // The road goal on its own still works — the guard is about terrain, not
  // about refusing whenever two goals are mentioned.
  expect(formatPaceMinKm(goalPace('1:50 half marathon')!.paceMinKm)).toBe('5:13');
});

test('the rendered source is short, not the whole goal field', () => {
  // The goal column holds paragraphs; dumping it into a prompt header buries
  // the number the block exists to state.
  const g = goalPace('sub 1:50 half marathon, building back after a break')!;
  expect(g.source).toBe('1:50 half marathon');
});

test('the terrain pattern contains no invisible control characters', () => {
  // This test exists because the pattern once began with a literal 0x08
  // (backspace) instead of \b, introduced by a shell-escaping slip. It matched
  // nothing, while rendering identically to the correct pattern in every grep,
  // cat and editor view. The regex is now built from an array of strings for
  // the same reason.
  const source = TERRAIN_WITHOUT_FLAT_PACE.source;
  // eslint-disable-next-line no-control-regex
  expect(/[\x00-\x1f]/.test(source)).toBe(false);

  // And it does the job it exists for, on the athlete's real profile text.
  expect(
    TERRAIN_WITHOUT_FLAT_PACE.test('21K trail race, 1300m gain (61.9 m/km avg) on 2027-07-03'),
  ).toBe(true);
  expect(TERRAIN_WITHOUT_FLAT_PACE.test('sub 1:50 half marathon')).toBe(false);
});
