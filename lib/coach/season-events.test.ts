import { describe, expect, it } from 'bun:test';
import {
  formatEventsForPlan, formatEventsForReview, formatEventsForSeason, matchEventRun,
  parseTuneUpSlots, placeEvent, placedEvents, slotToEvent, type SeasonEvent,
} from './season-events';

const ev = (o: Partial<SeasonEvent>): SeasonEvent => ({
  id: 'e', user_id: 'u', source: 'athlete', status: 'planned', priority: 'C', name: 'Hills 15K',
  event_date: '2026-12-11', window_start: null, window_end: null, distance_km: 15, elevation_gain_m: 600,
  purpose: null, url: null, notes: null, macro_plan_id: null, run_id: null, created_at: '', updated_at: '', ...o,
});

describe('placing events on plan weeks', () => {
  it('Sunday-start weeks: week and weekday', () => {
    expect(placeEvent('2026-11-08', '2026-11-08', 4)).toEqual({ week: 1, day: 'Sunday' });
    expect(placeEvent('2026-12-11', '2026-11-08', 6)).toEqual({ week: 5, day: 'Friday' });
  });
  it('outside the plan is not placed', () => {
    expect(placeEvent('2026-11-07', '2026-11-08', 4)).toBeNull();
    expect(placeEvent('2026-12-06', '2026-11-08', 4)).toBeNull();
  });
  it('only planned, dated events are placed', () => {
    const p = placedEvents([ev({}), ev({ status: 'suggested', event_date: null }), ev({ status: 'skipped' })], '2026-11-08', 6);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ week: 5, day: 'Friday', priority: 'C' });
  });
});

describe('prompt blocks', () => {
  it('plan block names the event, its day, and the rule for its priority only', () => {
    const t = formatEventsForPlan(placedEvents([ev({ priority: 'B' })], '2026-11-08', 6));
    expect(t).toContain('Week 5, Friday 2026-12-11: **Hills 15K** (B race)');
    expect(t).toContain('Mini-taper');
    expect(t).not.toContain('trained through');
    expect(formatEventsForPlan([])).toBe('');
  });
  it('season block forbids naming events and lists the ones he has', () => {
    const t = formatEventsForSeason([ev({})]);
    expect(t).toContain('2026-12-11: Hills 15K (C)');
    expect(t).toMatch(/NEVER name a specific event/);
  });
  it('review block: just raced and coming up', () => {
    const t = formatEventsForReview([ev({ event_date: '2026-12-11', status: 'done' }), ev({ event_date: '2026-12-25', name: 'Xmas trail' })], '2026-12-13');
    expect(t).toContain('Just raced');
    expect(t).toContain('Coming up');
    expect(formatEventsForReview([ev({ event_date: '2027-03-01' })], '2026-12-13')).toBe('');
  });
});

describe('coach slots', () => {
  it('parses, bounds and drops unusable slots', () => {
    const s = parseTuneUpSlots([
      { week: 10, window_weeks: 2, priority: 'B', distance_km: 15, elevation_gain_m: 700.4, purpose: 'Test climbing before phase 2 exit' },
      { week: 99, priority: 'C', purpose: 'beyond the horizon' },
      { week: 5, priority: 'X', purpose: '' },
      { week: 20, window_weeks: 9, priority: 'Z', purpose: 'Rehearsal' },
    ], 34);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ priority: 'B', elevation_gain_m: 700 });
    expect(s[1]).toMatchObject({ priority: 'C', window_weeks: 4 });
    expect(parseTuneUpSlots(undefined, 34)).toEqual([]);
  });
  it('a slot becomes a date window from the season start', () => {
    const e = slotToEvent({ week: 3, window_weeks: 2, priority: 'C', distance_km: 12, elevation_gain_m: null, purpose: 'p' }, '2026-11-08');
    expect(e).toMatchObject({ window_start: '2026-11-22', window_end: '2026-12-05', status: 'suggested', source: 'coach' });
  });
});

it('matches the longest run on the event day', () => {
  const runs = [{ id: 'a', day: '2026-12-11', distance_km: 2 }, { id: 'b', day: '2026-12-11', distance_km: 15.2 }, { id: 'c', day: '2026-12-10', distance_km: 30 }];
  expect(matchEventRun('2026-12-11', runs)?.id).toBe('b');
  expect(matchEventRun('2026-12-12', runs)).toBeNull();
});
