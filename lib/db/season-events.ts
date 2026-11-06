/**
 * Training races and events — database access. Pure logic lives in
 * lib/coach/season-events.ts.
 */

import { supabase } from '@/lib/db/supabase';
import { userDateStr, utcFromUserLocal } from '@/lib/utils/user-time';
import { matchEventRun, slotToEvent, type SeasonEvent, type TuneUpSlot } from '@/lib/coach/season-events';

/** Fields the athlete may set. Everything else is the app's. */
export const EDITABLE = ['name', 'event_date', 'priority', 'distance_km', 'elevation_gain_m', 'purpose', 'url', 'notes', 'status'] as const;
export type EventPatch = Partial<Pick<SeasonEvent, (typeof EDITABLE)[number]>>;

export async function listEvents(userId: string): Promise<SeasonEvent[]> {
  const { data, error } = await supabase.from('season_events').select('*').eq('user_id', userId)
    .order('event_date', { ascending: true, nullsFirst: false }).order('window_start', { ascending: true });
  if (error) {
    console.error('season events: list failed:', error.message);
    return [];
  }
  return (data ?? []) as SeasonEvent[];
}

/** Planned events between two dates (inclusive), for the plan builders. */
export async function plannedEventsBetween(userId: string, from: string, to: string): Promise<SeasonEvent[]> {
  const { data } = await supabase.from('season_events').select('*').eq('user_id', userId)
    .eq('status', 'planned').gte('event_date', from).lte('event_date', to);
  return (data ?? []) as SeasonEvent[];
}

export async function createEvent(userId: string, patch: EventPatch): Promise<SeasonEvent | null> {
  const { data, error } = await supabase.from('season_events')
    .insert({ user_id: userId, source: 'athlete', status: 'planned', ...patch })
    .select('*').single();
  if (error) throw new Error(error.message);
  return data as SeasonEvent;
}

/**
 * Update an event. Filling a coach slot (giving it a date) makes it planned —
 * the slot keeps source='coach' so the UI can still say who suggested it.
 */
export async function updateEvent(userId: string, id: string, patch: EventPatch): Promise<SeasonEvent | null> {
  const { data: current } = await supabase.from('season_events').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!current) return null;
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if ((current as SeasonEvent).status === 'suggested' && patch.event_date && !patch.status) next.status = 'planned';
  // Moving an event, or un-doing it, drops a stale result match.
  if (patch.event_date && patch.event_date !== (current as SeasonEvent).event_date) next.run_id = null;
  const { data, error } = await supabase.from('season_events').update(next).eq('id', id).eq('user_id', userId).select('*').single();
  if (error) throw new Error(error.message);
  return data as SeasonEvent;
}

export async function deleteEvent(userId: string, id: string): Promise<boolean> {
  const { error, count } = await supabase.from('season_events').delete({ count: 'exact' }).eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * Replace the coach's unfilled slots with a new season's. A slot the athlete
 * has already filled with a real event is his now and is kept.
 */
export async function replaceCoachSlots(userId: string, macroPlanId: string, seasonStart: string, slots: TuneUpSlot[]): Promise<void> {
  await supabase.from('season_events').delete().eq('user_id', userId).eq('source', 'coach').eq('status', 'suggested');
  if (!slots.length) return;
  const rows = slots.map((s) => ({ user_id: userId, macro_plan_id: macroPlanId, ...slotToEvent(s, seasonStart) }));
  const { error } = await supabase.from('season_events').insert(rows);
  if (error) console.error('season events: slots not saved:', error.message);
}

/**
 * Link past planned events to the run that was the event (same day in Israel
 * time, the longest run that day) and mark them done. Cheap and idempotent,
 * so it runs whenever the events are read.
 */
export async function syncEventResults(userId: string, events: SeasonEvent[]): Promise<SeasonEvent[]> {
  const today = userDateStr();
  const due = events.filter((e) => e.status === 'planned' && e.event_date && e.event_date <= today && !e.run_id);
  if (!due.length) return events;
  const from = utcFromUserLocal(`${due.reduce((a, e) => (e.event_date! < a ? e.event_date! : a), due[0].event_date!)}T00:00:00`);
  const to = utcFromUserLocal(`${today}T23:59:59`);
  const { data: runs } = await supabase.from('runs').select('id,date,distance_km').eq('user_id', userId).gte('date', from).lte('date', to);
  const byDay = ((runs ?? []) as { id: string; date: string; distance_km: number | null }[])
    .map((r) => ({ ...r, day: userDateStr(new Date(r.date)) }));
  const updated = new Map<string, SeasonEvent>();
  for (const e of due) {
    const run = matchEventRun(e.event_date!, byDay);
    if (!run) continue;
    const { data } = await supabase.from('season_events')
      .update({ run_id: run.id, status: 'done', updated_at: new Date().toISOString() })
      .eq('id', e.id).select('*').single();
    if (data) updated.set(e.id, data as SeasonEvent);
  }
  return events.map((e) => updated.get(e.id) ?? e);
}
