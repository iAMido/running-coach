/**
 * Run with `bun test`.
 *
 * These pin the two behaviours the race-demand block exists for: that a road
 * plan is completely untouched by it, and that when elevation IS present the
 * gap is stated as a number drawn from the athlete's own history rather than
 * left for the model to guess at.
 */

import { expect, test } from 'bun:test';
import { buildRaceDemandBlock } from '@/lib/ai/coach-prompts';

const CLIMB = {
  measuredRuns: 128,
  medianVertPerKm: 8.8,
  maxVertPerKm: 20.2,
  maxGainM: 565,
  avgWeeklyGainM: 210,
};

test('a road plan is untouched — no elevation, no block', () => {
  // The whole code path has to be invisible to a flat-race plan, or every
  // existing plan type quietly changes shape.
  expect(buildRaceDemandBlock(undefined)).toBe('');
  expect(buildRaceDemandBlock({ distanceKm: 21 })).toBe('');
  expect(buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 0 })).toBe('');
});

test('the gradient is computed, not left to the model to divide', () => {
  const block = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 1300, climb: CLIMB });
  expect(block).toContain('61.9 m/km');
  expect(block).toContain('1300 m');
  expect(block).toContain('over 21 km');
});

test('the gap is stated against his own measured history', () => {
  const block = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 1300, climb: CLIMB });
  // 61.9 / 20.2 = 3.1x steepest ever; 61.9 / 8.8 = 7.0x median.
  expect(block).toContain('3.1x his steepest run ever');
  expect(block).toContain('7.0x his median');
  expect(block).toContain('128 runs with elevation');
  // The instruction that follows from the gap — distance is not the problem.
  expect(block).toContain('gradient as the limiter');
});

test('no measured history says so instead of inventing a starting point', () => {
  const block = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 1300 });
  expect(block).toContain('No measured climbing history');
  expect(block).toContain('conservatively');
  // Must NOT fabricate a comparison it cannot make.
  expect(block).not.toContain('his steepest run ever');
});

test('descent, power-hiking and the injury history are all required of the plan', () => {
  const block = buildRaceDemandBlock({ distanceKm: 21, elevationGainM: 1300, climb: CLIMB });
  // Descent is the stressor gym climbing cannot cover and the one carrying
  // this athlete's specific injury risk.
  expect(block).toContain('descent as its own stressor');
  expect(block).toContain('plantar fasciitis');
  expect(block).toContain('power-hiking');
  // Vert is cut before km in a down week — climbing is the newer stress.
  expect(block).toContain('cut vert BEFORE km');
});

test('terrain access constrains what may be prescribed', () => {
  const block = buildRaceDemandBlock({
    distanceKm: 21,
    elevationGainM: 1300,
    terrainAccess: 'flat roads locally, hills 40 min away',
    climb: CLIMB,
  });
  expect(block).toContain('flat roads locally, hills 40 min away');
  expect(block).toContain('will not be run');
});
