/**
 * Training races and events — pure logic (no database).
 *
 * The split of responsibility (athlete's design, 2026-11-06):
 *   - the season head coach decides WHAT KIND of event the season needs and
 *     WHEN — a "slot" with a date window, distance, climbing, priority, purpose;
 *   - the athlete decides WHICH REAL EVENT fills it, or adds his own.
 * The coach never names a specific race: it cannot know the race calendar,
 * and a confident invented event is worse than an empty slot.
 *
 * Priority:
 *   A — the goal race (the season's own race; not stored here as a rule)
 *   B — mini-taper before, recovery after; it is a real test
 *   C — trained through: it replaces a key session, no taper
 */

export type EventPriority = 'A' | 'B' | 'C';
export type EventStatus = 'suggested' | 'planned' | 'done' | 'skipped';

export interface SeasonEvent {
  id: string;
  user_id: string;
  source: 'coach' | 'athlete';
  status: EventStatus;
  priority: EventPriority;
  name: string | null;
  event_date: string | null;
  window_start: string | null;
  window_end: string | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  purpose: string | null;
  url: string | null;
  notes: string | null;
  macro_plan_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A coach slot as the season head coach writes it. */
export interface TuneUpSlot {
  /** 1-based season week the window starts in. */
  week: number;
  /** Window length in weeks (1-4). */
  window_weeks: number;
  priority: 'B' | 'C';
  distance_km: number | null;
  elevation_gain_m: number | null;
  purpose: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Read the season's "tune_up_slots" array, dropping anything unusable. */
export function parseTuneUpSlots(raw: unknown, horizonWeeks: number): TuneUpSlot[] {
  if (!Array.isArray(raw)) return [];
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return raw
    .map((r: Record<string, unknown>) => ({
      week: Math.round(Number(r?.week)),
      window_weeks: Math.min(4, Math.max(1, Math.round(Number(r?.window_weeks ?? 2)))),
      priority: (r?.priority === 'B' ? 'B' : 'C') as 'B' | 'C',
      distance_km: num(r?.distance_km),
      elevation_gain_m: num(r?.elevation_gain_m) === null ? null : Math.round(num(r?.elevation_gain_m)!),
      purpose: String(r?.purpose ?? '').trim(),
    }))
    .filter((s) => Number.isFinite(s.week) && s.week >= 1 && s.week <= horizonWeeks && s.purpose)
    .slice(0, 6);
}

/** A slot as a database row: its season weeks turned into a date window. */
export function slotToEvent(slot: TuneUpSlot, seasonStart: string) {
  const window_start = addDays(seasonStart, (slot.week - 1) * 7);
  return {
    source: 'coach' as const,
    status: 'suggested' as const,
    priority: slot.priority,
    window_start,
    window_end: addDays(window_start, slot.window_weeks * 7 - 1),
    distance_km: slot.distance_km,
    elevation_gain_m: slot.elevation_gain_m,
    purpose: slot.purpose,
  };
}

/** Where a dated event falls in a plan that starts on `planStart` (a Sunday). */
export function placeEvent(eventDate: string, planStart: string, weeks: number): { week: number; day: (typeof DAYS)[number] } | null {
  const d = daysBetween(planStart, eventDate);
  if (d < 0 || d >= weeks * 7) return null;
  return { week: Math.floor(d / 7) + 1, day: DAYS[d % 7] };
}

export interface PlacedEvent {
  name: string;
  date: string;
  week: number;
  day: string;
  priority: EventPriority;
  distance_km: number | null;
  elevation_gain_m: number | null;
  purpose: string | null;
}

/** The dated, planned events that fall inside a plan, placed on its weeks. */
export function placedEvents(events: SeasonEvent[], planStart: string, weeks: number): PlacedEvent[] {
  return events
    .filter((e) => e.status === 'planned' && e.event_date)
    .map((e): PlacedEvent | null => {
      const p = placeEvent(e.event_date!, planStart, weeks);
      return p ? {
        name: e.name || 'Training race', date: e.event_date!, week: p.week, day: p.day, priority: e.priority,
        distance_km: e.distance_km, elevation_gain_m: e.elevation_gain_m, purpose: e.purpose,
      } : null;
    })
    .filter((x): x is PlacedEvent => !!x)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const PRIORITY_RULE: Record<EventPriority, string> = {
  A: 'A race: full taper into it, as the goal race.',
  B: 'B race: a real test. Mini-taper — the 3-4 days before are easy with one short sharpener, no strength in those days; it REPLACES that week\'s long run; 3-5 easy days after, no quality until his legs are back.',
  C: 'C race: trained through. It REPLACES that week\'s long run or quality session (whichever it resembles); no taper; normal week after, with an easy day straight after it.',
};

/** The block for every plan prompt (outline, writers, review). '' when there is nothing. */
export function formatEventsForPlan(placed: PlacedEvent[]): string {
  if (placed.length === 0) return '';
  const lines = placed.map((e) =>
    `- Week ${e.week}, ${e.day} ${e.date}: **${e.name}** (${e.priority} race)` +
    (e.distance_km ? ` · ${e.distance_km} km` : '') +
    (e.elevation_gain_m ? ` · ${e.elevation_gain_m} m climbing` : '') +
    (e.purpose ? ` — ${e.purpose}` : ''),
  );
  const rules = [...new Set(placed.map((e) => e.priority))].map((p) => `- ${PRIORITY_RULE[p]}`);
  return [
    '## RACES AND EVENTS ALREADY ON HIS CALENDAR — FIXED POINTS',
    ...lines,
    '',
    'Put the event itself on its date as that day\'s session: type "Race", the event name in the description, distance and climb as the prescription, a pacing and fuelling note. It may fall on a day outside his usual training days — that is allowed for an event. Shape the surrounding days by priority:',
    ...rules,
    'Count the event in the week\'s km and climbing.',
  ].join('\n');
}

/** For the season head coach: the events he already has, and the slot task. */
export function formatEventsForSeason(events: SeasonEvent[]): string {
  const planned = events.filter((e) => e.status === 'planned' && e.event_date);
  const lines = planned.map((e) =>
    `- ${e.event_date}: ${e.name || 'Training race'} (${e.priority})` +
    (e.distance_km ? ` · ${e.distance_km} km` : '') + (e.elevation_gain_m ? ` · ${e.elevation_gain_m} m` : ''),
  );
  return [
    '## TRAINING RACES',
    lines.length
      ? `He already has these on his calendar — design around them, and do not suggest a slot that duplicates one:\n${lines.join('\n')}`
      : 'He has no training races on his calendar yet.',
    '',
    'Add a top-level "tune_up_slots" array: 0-4 training races this season NEEDS, each placed where it serves a phase — a test of a phase\'s capability before its exit, a race-day rehearsal (kit, fuelling, pacing on climbs and descents), or a long run with company and aid stations. NEVER name a specific event — you cannot know the race calendar; describe what to look for and he will find a real one.',
    'Each: { "week": <season week the window starts>, "window_weeks": 1-4, "priority": "B" | "C", "distance_km": n, "elevation_gain_m": n, "purpose": "one sentence: what it tests and why then" }.',
    'B = a real test with a mini-taper; at most 2, never in the last 3 weeks before the goal race. C = trained through. No slot in the taper.',
  ].join('\n');
}

/** For the weekly review / Saturday proposal: races just done and coming up. */
export function formatEventsForReview(events: SeasonEvent[], today: string): string {
  const recent = events.filter((e) => e.event_date && e.status !== 'suggested' &&
    daysBetween(e.event_date, today) >= 0 && daysBetween(e.event_date, today) <= 10);
  const upcoming = events.filter((e) => e.event_date && e.status === 'planned' &&
    daysBetween(today, e.event_date) > 0 && daysBetween(today, e.event_date) <= 21);
  if (!recent.length && !upcoming.length) return '';
  const fmt = (e: SeasonEvent) => `${e.event_date} ${e.name || 'Training race'} (${e.priority})${e.distance_km ? ` ${e.distance_km} km` : ''}${e.elevation_gain_m ? `/${e.elevation_gain_m} m` : ''}`;
  return [
    '## TRAINING RACES',
    recent.length ? `Just raced (treat that run as a race, not a hard training run): ${recent.map((e) => `${fmt(e)}${e.status === 'done' ? '' : e.status === 'skipped' ? ' — skipped' : ' — no run matched yet'}`).join('; ')}` : '',
    upcoming.length ? `Coming up — protect the build-in and recovery around it: ${upcoming.map(fmt).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * The plan-adjust request that fits one event into the active plan — only the
 * weeks around it. Null when the event is outside the plan.
 */
export function fitRequestText(event: SeasonEvent, planStart: string, weeks: number): string | null {
  const placed = placedEvents([{ ...event, status: 'planned' }], planStart, weeks);
  if (!placed.length) return null;
  const e = placed[0];
  return [
    `I have added a training race to my calendar. Fit it into my plan, changing ONLY week ${e.week}${e.week > 1 ? ` and the week before it (${e.week - 1})` : ''}${e.week < weeks ? ` and the week after (${e.week + 1})` : ''}; leave every other week exactly as it is.`,
    '',
    formatEventsForPlan(placed),
  ].join('\n');
}

/** The run that was the event: same calendar day, the longest run that day. */
export function matchEventRun<R extends { id: string; day: string; distance_km: number | null }>(eventDate: string, runs: R[]): R | null {
  const same = runs.filter((r) => r.day === eventDate);
  if (!same.length) return null;
  return same.reduce((a, b) => ((b.distance_km ?? 0) > (a.distance_km ?? 0) ? b : a));
}
