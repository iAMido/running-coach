'use client';

/**
 * Training races and events on the Season tab.
 *
 * The coach suggests SLOTS (what kind of event, which weeks, why); the athlete
 * fills a slot with a real event or adds his own. The coach never names an
 * event — it cannot know the race calendar.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trophy, Plus, Sparkles, Trash2, CalendarCheck, Wand2, ExternalLink } from 'lucide-react';
import { fitRequestText, placeEvent, type SeasonEvent } from '@/lib/coach/season-events';

interface RunResult {
  id: string;
  date: string;
  distance_km: number | null;
  duration_min: number | null;
  avg_pace_str: string | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
}

interface Draft {
  name: string;
  event_date: string;
  priority: 'B' | 'C';
  distance_km: string;
  elevation_gain_m: string;
  url: string;
  notes: string;
}

const EMPTY: Draft = { name: '', event_date: '', priority: 'C', distance_km: '', elevation_gain_m: '', url: '', notes: '' };

const PRIORITY_HELP: Record<string, string> = {
  A: 'Goal race',
  B: 'A real test — mini-taper before, easy days after',
  C: 'Trained through — replaces a key session, no taper',
};

export function SeasonEventsPanel({ plan, refreshKey, onPlanChanged }: {
  /** The active training plan's window, to offer "fit into my plan". */
  plan: { start_date: string | null; duration_weeks: number } | null;
  /** Changes when the season is redesigned — its slots are new. */
  refreshKey?: string | null;
  onPlanChanged?: () => void;
}) {
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/events');
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
      setRuns(data.runs ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  function startEdit(e: SeasonEvent | null) {
    setError(null);
    setMessage(null);
    if (!e) {
      setDraft(EMPTY);
      setEditing('new');
      return;
    }
    setDraft({
      name: e.name ?? '',
      event_date: e.event_date ?? '',
      priority: e.priority === 'B' ? 'B' : 'C',
      distance_km: e.distance_km != null ? String(e.distance_km) : '',
      elevation_gain_m: e.elevation_gain_m != null ? String(e.elevation_gain_m) : '',
      url: e.url ?? '',
      notes: e.notes ?? '',
    });
    setEditing(e.id);
  }

  async function save() {
    if (!draft.name || !draft.event_date) {
      setError('A race needs a name and a date.');
      return;
    }
    setBusy('save');
    setError(null);
    const body = {
      name: draft.name,
      event_date: draft.event_date,
      priority: draft.priority,
      distance_km: draft.distance_km ? parseFloat(draft.distance_km) : null,
      elevation_gain_m: draft.elevation_gain_m ? parseInt(draft.elevation_gain_m, 10) : null,
      url: draft.url || null,
      notes: draft.notes || null,
    };
    try {
      const res = await fetch(editing === 'new' ? '/api/coach/events' : `/api/coach/events/${editing}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not save the race.');
      setEditing(null);
      await load();
      const inPlan = plan?.start_date && placeEvent(draft.event_date, plan.start_date, plan.duration_weeks);
      setMessage(inPlan
        ? `${draft.name} is inside your current plan (week ${inPlan.week}). Use "Fit into my plan" to reshape the weeks around it.`
        : `${draft.name} is saved. The plan for the phase it falls in will be built around it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the race.');
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await fetch(`/api/coach/events/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/coach/events/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** Reshape only the weeks around the race (plan adjust, ~1 min). */
  async function fit(e: SeasonEvent) {
    if (!plan?.start_date) return;
    const text = fitRequestText(e, plan.start_date, plan.duration_weeks);
    if (!text) return;
    setBusy(`fit:${e.id}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/coach/plans/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustmentType: 'user_request', userRequest: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not fit the race into your plan.');
      setMessage(`Your plan now builds around ${e.name}. See Current plan.`);
      onPlanChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fit the race into your plan.');
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  const slots = events.filter((e) => e.status === 'suggested');
  const races = events.filter((e) => e.status !== 'suggested');
  const resultOf = (e: SeasonEvent) => runs.find((r) => r.id === e.run_id) ?? null;
  const editingSlot = editing && editing !== 'new' ? events.find((e) => e.id === editing) : null;

  return (
    <div className="rc-card p-0 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
        <div>
          <div className="rc-kicker mb-1">Training races</div>
          <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>
            Races & events
          </h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--rc-ink-3)' }}>
            The coach suggests what kind of race and when; you pick the real event.
          </p>
        </div>
        <div className="p-2.5 rounded-xl" style={{ background: 'oklch(0.96 0.04 80)', color: 'oklch(0.5 0.13 70)' }}>
          <Trophy className="w-4 h-4" />
        </div>
      </div>

      <div className="p-6 space-y-4">
        {message && <p className="text-[12.5px]" style={{ color: 'oklch(0.45 0.13 150)' }}>{message}</p>}
        {error && <p className="text-[12.5px]" style={{ color: 'oklch(0.5 0.18 25)' }}>{error}</p>}

        {races.length > 0 && (
          <div className="space-y-2">
            {races.map((e) => {
              const r = resultOf(e);
              const inPlan = e.status === 'planned' && e.event_date && plan?.start_date
                ? placeEvent(e.event_date, plan.start_date, plan.duration_weeks) : null;
              return (
                <div key={e.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold" style={{ color: 'var(--rc-ink)' }}>
                        <PriorityChip p={e.priority} /> {e.name}
                        {e.url && (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex ml-1.5 align-middle" style={{ color: 'var(--rc-ink-4)' }}>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="rc-mono text-[11.5px]" style={{ color: 'var(--rc-ink-3)' }}>
                        {e.event_date}
                        {e.distance_km ? ` · ${e.distance_km} km` : ''}
                        {e.elevation_gain_m ? ` · ${e.elevation_gain_m} m` : ''}
                        {inPlan ? ` · plan week ${inPlan.week}` : ''}
                        {e.source === 'coach' ? ' · coach slot' : ''}
                      </div>
                      {e.purpose && <p className="text-[12px] mt-1" style={{ color: 'var(--rc-ink-3)' }}>{e.purpose}</p>}
                      {e.status === 'done' && (
                        <p className="text-[12px] mt-1 flex items-center gap-1.5" style={{ color: 'oklch(0.45 0.13 150)' }}>
                          <CalendarCheck className="w-3.5 h-3.5" />
                          {r ? `Done: ${r.distance_km ?? '?'} km${r.duration_min ? ` in ${fmtDuration(r.duration_min)}` : ''}${r.avg_pace_str ? ` · ${r.avg_pace_str}/km` : ''}${r.elevation_gain_m != null ? ` · ${r.elevation_gain_m} m` : ''}${r.avg_hr ? ` · ${r.avg_hr} bpm` : ''}` : 'Done'}
                        </p>
                      )}
                      {e.status === 'skipped' && <p className="text-[12px] mt-1" style={{ color: 'var(--rc-ink-4)' }}>Skipped</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {inPlan && (
                        <SmallButton primary disabled={!!busy} onClick={() => fit(e)} icon={<Wand2 className="w-3 h-3" />}
                          label={busy === `fit:${e.id}` ? 'Fitting… (~1 min)' : 'Fit into my plan'} />
                      )}
                      {e.status === 'planned' && <SmallButton disabled={!!busy} onClick={() => startEdit(e)} label="Edit" />}
                      {e.status === 'planned' && e.event_date && e.event_date < today() && (
                        <SmallButton disabled={!!busy} onClick={() => patch(e.id, { status: 'skipped' })} label="Didn't race" />
                      )}
                      <button type="button" disabled={!!busy} onClick={() => remove(e.id)} className="p-1 disabled:opacity-40" title="Remove" style={{ color: 'var(--rc-ink-4)' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {slots.length > 0 && (
          <div className="space-y-2">
            <p className="rc-mono text-[10.5px] uppercase flex items-center gap-1.5" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.08em' }}>
              <Sparkles className="w-3 h-3" /> Suggested by the head coach — find a real race for each
            </p>
            {slots.map((s) => (
              <div key={s.id} className="rounded-xl px-4 py-3" style={{ border: '1px dashed var(--rc-line)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--rc-ink)' }}>
                      <PriorityChip p={s.priority} />{' '}
                      {s.distance_km ? `${s.distance_km} km` : 'Race'}
                      {s.elevation_gain_m ? ` · ${s.elevation_gain_m} m climbing` : ''}
                    </div>
                    <div className="rc-mono text-[11.5px]" style={{ color: 'var(--rc-ink-3)' }}>
                      between {s.window_start} and {s.window_end} · {PRIORITY_HELP[s.priority]}
                    </div>
                    {s.purpose && <p className="text-[12px] mt-1" style={{ color: 'var(--rc-ink-2)' }}>{s.purpose}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <SmallButton primary disabled={!!busy} onClick={() => startEdit(s)} label="I found one" />
                    <button type="button" disabled={!!busy} onClick={() => remove(s.id)} className="p-1 disabled:opacity-40" title="Not for me" style={{ color: 'var(--rc-ink-4)' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {races.length === 0 && slots.length === 0 && editing === null && (
          <p className="text-[12.5px]" style={{ color: 'var(--rc-ink-3)' }}>
            No training races yet. Add one you already have in mind, or adjust the season — the head coach will suggest where races would help.
          </p>
        )}

        {editing !== null ? (
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
            {editingSlot?.status === 'suggested' && (
              <p className="text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>
                The coach is looking for: {editingSlot.purpose} — ideally between {editingSlot.window_start} and {editingSlot.window_end}.
              </p>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Race name">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Hills of Jerusalem 15K" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Date">
                <input type="date" value={draft.event_date} onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Distance (km)">
                <input type="number" step="0.1" value={draft.distance_km} onChange={(e) => setDraft({ ...draft, distance_km: e.target.value })} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Climbing (m)">
                <input type="number" step="10" value={draft.elevation_gain_m} onChange={(e) => setDraft({ ...draft, elevation_gain_m: e.target.value })} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Priority">
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as 'B' | 'C' })} className={INPUT} style={INPUT_STYLE}>
                  <option value="C">C — {PRIORITY_HELP.C}</option>
                  <option value="B">B — {PRIORITY_HELP.B}</option>
                </select>
              </Field>
              <Field label="Link (optional)">
                <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" className={INPUT} style={INPUT_STYLE} />
              </Field>
            </div>
            <Field label="Notes (optional)">
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. run it as a long run at Z2, practise poles" className={INPUT} style={INPUT_STYLE} />
            </Field>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy === 'save'} className="px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-40" style={{ background: 'var(--rc-blue)', color: 'white' }}>
                {busy === 'save' ? 'Saving…' : 'Save race'}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-[13px] font-medium" style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => startEdit(null)} className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--rc-blue-deep)' }}>
            <Plus className="w-3.5 h-3.5" /> Add a race
          </button>
        )}
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`;
}

function PriorityChip({ p }: { p: string }) {
  const tone = p === 'A' ? 'oklch(0.5 0.18 25)' : p === 'B' ? 'oklch(0.5 0.13 70)' : 'var(--rc-ink-3)';
  return (
    <span className="rc-mono text-[10px] px-1.5 py-0.5 rounded mr-1 align-middle" style={{ border: `1px solid ${tone}`, color: tone }}>
      {p}
    </span>
  );
}

function SmallButton({ label, onClick, disabled, primary, icon }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium disabled:opacity-40"
      style={primary
        ? { background: 'var(--rc-blue)', color: 'white' }
        : { background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}
    >
      {icon}{label}
    </button>
  );
}

const INPUT = 'w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2';
const INPUT_STYLE = { background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium mb-1" style={{ color: 'var(--rc-ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}
