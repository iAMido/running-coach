/**
 * Run with `bun test`.
 *
 * The first test is the one that matters. Before 2026-09-26 a failed parse
 * saved `{ raw_response }` as the athlete's ACTIVE plan after retiring the
 * working one. `ok: false` is now the only way a bad response can come back,
 * and callers save only on `ok`.
 */

import { expect, test } from 'bun:test';
import { parsePlanOutput, planOutputTokenBudget } from '@/lib/coach/plan-output';
import { expandStrengthRefs } from '@/lib/coach/plan-strength';

const week = (n: number, extra: Record<string, unknown> = {}) => ({
  week_number: n, phase: 'Base', workouts: { Sunday: { type: 'Easy Run', ...extra } },
});

test('a response cut off mid-JSON is refused, never saved', () => {
  // Exactly what happened: a 12-week plan stopped at week 10 at the token cap.
  const cut = JSON.stringify({ weeks: Array.from({ length: 12 }, (_, i) => week(i + 1)) }).slice(0, 400);
  const r = parsePlanOutput(cut, { expectedWeeks: 12, finishReason: 'length' });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe('truncated');
    expect(r.message).toContain('Nothing was saved');
    expect(r.message).toContain('current plan is unchanged');
  }
});

test('the streaming path (no finish_reason) still detects truncation from the structure', () => {
  const cut = '{"weeks":[{"week_number":1,"workouts":{}},{"week_number":2,"workouts":{"Sunday":{"type":"Ea';
  const r = parsePlanOutput(cut, { expectedWeeks: 12 });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe('truncated');
    expect(r.weeksReturned).toBe(2);
  }
});

test('a plan that parses but is missing weeks is incomplete, not accepted', () => {
  const r = parsePlanOutput(JSON.stringify({ weeks: [week(1), week(2)] }), { expectedWeeks: 12 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('incomplete');
});

test('prose with no JSON is unparseable', () => {
  const r = parsePlanOutput('I could not build this plan because…', { expectedWeeks: 4 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('unparseable');
});

test('a complete plan is accepted, from bare JSON or a fenced block', () => {
  const body = JSON.stringify({ weeks: [week(1), week(2)] });
  expect(parsePlanOutput(body, { expectedWeeks: 2, finishReason: 'stop' }).ok).toBe(true);
  expect(parsePlanOutput('```json\n' + body + '\n```', { expectedWeeks: 2 }).ok).toBe(true);
});

test('strength references expand into full sessions before saving', () => {
  const session = { name: 'Foundation', duration_minutes: 25, exercises: [{ exercise: 'Glute Bridge', sets: 3, reps: 15 }] };
  const r = parsePlanOutput(
    JSON.stringify({ strength_sessions: { foundation: session }, weeks: [week(1, { strength: 'foundation' })] }),
    { expectedWeeks: 1 },
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    const w = (r.plan.weeks as { workouts: { Sunday: { strength: unknown } } }[])[0];
    // Downstream readers — card, adjust, watch push — see a full object.
    expect(w.workouts.Sunday.strength).toEqual(session);
    expect(r.strength).toEqual({ expanded: 1, dangling: [] });
  }
});

test('a reference to an undefined session is dropped, never rendered broken', () => {
  const plan = { strength_sessions: {}, weeks: [week(1, { strength: 'nonexistent' })] };
  const result = expandStrengthRefs(plan);
  expect(result.dangling).toEqual(['nonexistent']);
  expect('strength' in (plan.weeks[0].workouts.Sunday as Record<string, unknown>)).toBe(false);
});

test('expanded sessions are copies — editing one day cannot change another', () => {
  const plan = {
    strength_sessions: { s: { name: 'S', exercises: [{ exercise: 'A', sets: 1 }] } },
    weeks: [week(1, { strength: 's' }), week(2, { strength: 's' })],
  };
  expandStrengthRefs(plan);
  const a = plan.weeks[0].workouts.Sunday as unknown as { strength: { name: string } };
  const b = plan.weeks[1].workouts.Sunday as unknown as { strength: { name: string } };
  a.strength.name = 'changed';
  expect(b.strength.name).toBe('S');
});

test('inline strength objects from older plans pass through untouched', () => {
  const inline = { name: 'Old', exercises: [{ exercise: 'Plank', sets: 2 }] };
  const plan = { weeks: [week(1, { strength: inline })] };
  expect(expandStrengthRefs(plan)).toEqual({ expanded: 0, dangling: [] });
  expect((plan.weeks[0].workouts.Sunday as { strength: unknown }).strength).toBe(inline);
});

test('the output budget scales with plan length and stays bounded', () => {
  expect(planOutputTokenBudget(12)).toBe(28_000);
  expect(planOutputTokenBudget(4)).toBe(12_000);
  expect(planOutputTokenBudget(52)).toBe(64_000);
  // The old fixed 16,000 was below what a 12-week plan with strength needs.
  expect(planOutputTokenBudget(12)).toBeGreaterThan(16_000);
});
