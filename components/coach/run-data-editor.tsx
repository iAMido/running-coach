'use client';

/**
 * Mark a run as a treadmill session and enter what the treadmill showed —
 * distance, duration and total climbing — or work the climbing out from
 * grade, speed and time. Most treadmills never send incline to the watch, so
 * without this an indoor climbing session counts as "climbing not measured"
 * in the weekly totals and the phase KPIs. See lib/utils/treadmill.ts.
 */

import { useEffect, useState } from 'react';
import { Mountain, RotateCcw, Calculator } from 'lucide-react';
import type { Run } from '@/lib/db/types';
import { inclineSession } from '@/lib/utils/treadmill';

const INPUT = 'w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2';
const INPUT_STYLE = { background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' } as const;

export function RunDataEditor({ run, onSaved }: { run: Run; onSaved: (run: Run) => void }) {
  const [open, setOpen] = useState(false);
  const [treadmill, setTreadmill] = useState(!!run.is_treadmill);
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [climb, setClimb] = useState('');
  const [grade, setGrade] = useState('');
  const [speed, setSpeed] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the run's current numbers whenever a different run is selected.
  useEffect(() => {
    setOpen(false);
    setTreadmill(!!run.is_treadmill);
    setDistance(run.distance_km ? String(Math.round(run.distance_km * 100) / 100) : '');
    setDuration(run.duration_min ? String(Math.round(run.duration_min)) : '');
    setClimb(typeof run.elevation_gain_m === 'number' ? String(run.elevation_gain_m) : '');
    setGrade(''); setSpeed(''); setMinutes(''); setError(null);
  }, [run.id, run.is_treadmill, run.distance_km, run.duration_min, run.elevation_gain_m]);

  const calc = grade && speed && minutes ? inclineSession(parseFloat(grade), parseFloat(speed), parseFloat(minutes)) : null;
  const edited = !!run.manual_edit;
  const watch = run.manual_edit?.original;

  async function send(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      onSaved(data.run as Run);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    send({
      action: 'edit',
      is_treadmill: treadmill,
      ...(distance ? { distance_km: parseFloat(distance) } : {}),
      ...(duration ? { duration_min: parseFloat(duration) } : {}),
      ...(climb !== '' ? { elevation_gain_m: parseFloat(climb) } : {}),
      ...(calc ? { incline: { grade_pct: parseFloat(grade), speed_kmh: parseFloat(speed), minutes: parseFloat(minutes) } } : {}),
    });
  }

  return (
    <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px]" style={{ color: 'var(--rc-ink-2)' }}>
          <span className="font-medium">{run.is_treadmill ? 'Treadmill · ' : ''}{run.distance_km?.toFixed(1)} km · {Math.round(run.duration_min ?? 0)} min · </span>
          {typeof run.elevation_gain_m === 'number' ? `${run.elevation_gain_m} m climb` : <span style={{ color: 'oklch(0.55 0.13 60)' }}>climb not measured</span>}
          {edited && <span className="rc-mono text-[10px] ml-2" style={{ color: 'var(--rc-ink-4)' }}>ENTERED BY YOU</span>}
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="text-[12px] font-medium shrink-0" style={{ color: 'var(--rc-blue-deep)' }}>
            Treadmill / fix data
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--rc-ink)' }}>
            <input type="checkbox" checked={treadmill} onChange={(e) => setTreadmill(e.target.checked)} />
            Treadmill session
          </label>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Distance (km)"><input type="number" step="0.01" min="0" value={distance} onChange={(e) => setDistance(e.target.value)} className={INPUT} style={INPUT_STYLE} /></Field>
            <Field label="Duration (min)"><input type="number" step="1" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} className={INPUT} style={INPUT_STYLE} /></Field>
            <Field label="Total climb (m)"><input type="number" step="1" min="0" value={climb} onChange={(e) => setClimb(e.target.value)} placeholder="e.g. 480" className={INPUT} style={INPUT_STYLE} /></Field>
          </div>

          <details className="text-[12px]">
            <summary className="cursor-pointer flex items-center gap-1.5" style={{ color: 'var(--rc-ink-3)' }}>
              <Calculator className="w-3.5 h-3.5" /> Work it out from incline, speed and time
            </summary>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Field label="Grade (%)"><input type="number" step="0.5" min="0" value={grade} onChange={(e) => setGrade(e.target.value)} className={INPUT} style={INPUT_STYLE} /></Field>
              <Field label="Speed (km/h)"><input type="number" step="0.1" min="0" value={speed} onChange={(e) => setSpeed(e.target.value)} className={INPUT} style={INPUT_STYLE} /></Field>
              <Field label="Minutes"><input type="number" step="1" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={INPUT} style={INPUT_STYLE} /></Field>
            </div>
            {calc && (
              <div className="flex items-center justify-between mt-2">
                <span style={{ color: 'var(--rc-ink-2)' }}>
                  <Mountain className="w-3.5 h-3.5 inline mr-1" />≈ {calc.elevation_gain_m} m climb over {calc.distance_km} km
                </span>
                <button type="button" className="font-medium" style={{ color: 'var(--rc-blue-deep)' }}
                  onClick={() => { setClimb(String(calc.elevation_gain_m)); setTreadmill(true); }}>
                  Use {calc.elevation_gain_m} m
                </button>
              </div>
            )}
            <p className="mt-1.5" style={{ color: 'var(--rc-ink-4)' }}>
              For several blocks at different grades, add them up and enter the total climb above.
            </p>
          </details>

          {error && <p className="text-[12px]" style={{ color: 'oklch(0.5 0.18 25)' }}>{error}</p>}

          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={save} disabled={saving}
              className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium disabled:opacity-40" style={{ background: 'var(--rc-blue)', color: 'white' }}>
              {saving ? 'Saving…' : 'Save run data'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-3.5 py-2 rounded-xl text-[12.5px]" style={{ color: 'var(--rc-ink-3)' }}>
              Cancel
            </button>
            {edited && (
              <button type="button" onClick={() => send({ action: 'restore' })} disabled={saving}
                className="inline-flex items-center gap-1 text-[12px] ml-auto" style={{ color: 'var(--rc-ink-3)' }}>
                <RotateCcw className="w-3.5 h-3.5" /> Restore watch data
                {watch ? ` (${watch.distance_km ?? '?'} km, ${typeof watch.elevation_gain_m === 'number' ? `${watch.elevation_gain_m} m` : 'climb not measured'})` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="rc-mono text-[10px] uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  );
}
