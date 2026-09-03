'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mountain, Flag, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

interface Phase {
  phase_number: number;
  name: string;
  focus: string;
  weeks: number;
  weekly_km_range: [number, number] | null;
  weekly_vert_range_m: [number, number] | null;
  long_run_vert_ceiling_m: number | null;
  capability: string;
  exit_criteria: string[];
  key_sessions: string[];
}

export interface SeasonPlan {
  id: string;
  goal_name: string;
  race_date: string | null;
  race_distance_km: number | null;
  race_elevation_gain_m: number | null;
  horizon_weeks: number;
  phases: Phase[];
  rationale: string | null;
  revision: number;
}

/**
 * The season, and the form that creates one.
 *
 * Reports the plan back to the parent via `onLoaded` so the block generator can
 * pass `macroPlanId` — a block that does not know its phase is a standalone
 * plan, which is valid but is not what someone with a season wants.
 */
export function SeasonPlanPanel({ onLoaded }: { onLoaded?: (plan: SeasonPlan | null) => void }) {
  const [plan, setPlan] = useState<SeasonPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [goalName, setGoalName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [horizonWeeks, setHorizonWeeks] = useState('');
  const [raceDistanceKm, setRaceDistanceKm] = useState('');
  const [raceElevationGainM, setRaceElevationGainM] = useState('');
  const [terrainAccess, setTerrainAccess] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/macro-plan');
      if (!res.ok) return;
      const data = await res.json();
      setPlan(data.macroPlan ?? null);
      onLoaded?.(data.macroPlan ?? null);
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Weeks between today and the race, so the horizon is not typed by hand and
   * then quietly wrong. Only a suggestion — the athlete can override.
   */
  useEffect(() => {
    if (!raceDate || horizonWeeks) return;
    const weeks = Math.round((Date.parse(raceDate) - Date.now()) / (7 * 24 * 3600 * 1000));
    if (weeks > 0) setHorizonWeeks(String(weeks));
  }, [raceDate, horizonWeeks]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/macro-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goalName,
          horizonWeeks: parseInt(horizonWeeks, 10),
          ...(raceDate ? { raceDate } : {}),
          ...(raceDistanceKm ? { raceDistanceKm: parseFloat(raceDistanceKm) } : {}),
          ...(raceElevationGainM ? { raceElevationGainM: parseInt(raceElevationGainM, 10) } : {}),
          ...(terrainAccess ? { terrainAccess } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not design the season.');
        return;
      }
      setPlan(data.macroPlan);
      onLoaded?.(data.macroPlan);
      setShowForm(false);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return null;

  const gradient =
    plan?.race_elevation_gain_m && plan?.race_distance_km
      ? plan.race_elevation_gain_m / plan.race_distance_km
      : null;

  return (
    <div className="rc-card p-0 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
        <div>
          <div className="rc-kicker mb-1">Season</div>
          <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>
            {plan ? plan.goal_name : 'No season plan yet'}
          </h3>
          {plan && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--rc-ink-3)' }}>
              {plan.horizon_weeks} weeks · {plan.phases.length} phases
              {plan.race_date ? ` · race ${plan.race_date}` : ''}
              {gradient !== null ? ` · ${gradient.toFixed(1)} m/km` : ''}
              {plan.revision > 1 ? ` · revision ${plan.revision}` : ''}
            </p>
          )}
        </div>
        <div className="p-2.5 rounded-xl" style={{ background: 'oklch(0.96 0.04 145)', color: 'oklch(0.42 0.14 145)' }}>
          <Flag className="w-4 h-4" />
        </div>
      </div>

      <div className="p-6">
        {plan && plan.rationale && (
          <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--rc-ink-2)' }}>
            {plan.rationale}
          </p>
        )}

        {plan && (
          <div className="space-y-2 mb-4">
            {plan.phases.map((p) => {
              const open = expanded === p.phase_number;
              return (
                <div key={p.phase_number} className="rounded-xl" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.phase_number)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold" style={{ color: 'var(--rc-ink)' }}>
                        {p.phase_number}. {p.name}
                        <span className="rc-mono font-normal text-[11px] ml-2" style={{ color: 'var(--rc-ink-4)' }}>
                          {p.weeks}w
                        </span>
                      </div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--rc-ink-3)' }}>{p.focus}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {p.weekly_vert_range_m && (
                        <span className="rc-mono text-[11px] flex items-center gap-1" style={{ color: 'oklch(0.45 0.14 145)' }}>
                          <Mountain className="w-3 h-3" />
                          {p.weekly_vert_range_m[0]}–{p.weekly_vert_range_m[1]}m
                        </span>
                      )}
                      {open ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--rc-ink-4)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--rc-ink-4)' }} />}
                    </div>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 space-y-2.5 text-[12.5px]" style={{ color: 'var(--rc-ink-2)' }}>
                      <p><strong>Building:</strong> {p.capability}</p>
                      {p.weekly_km_range && <p className="rc-mono text-[11.5px]" style={{ color: 'var(--rc-ink-3)' }}>
                        {p.weekly_km_range[0]}–{p.weekly_km_range[1]} km/wk
                        {p.long_run_vert_ceiling_m ? ` · long-run vert ceiling ${p.long_run_vert_ceiling_m} m` : ''}
                      </p>}
                      {/* Exit criteria are the mechanism, so they are shown in
                          full rather than summarised — a phase advances when
                          these hold, not when its weeks run out. */}
                      <div>
                        <p className="rc-mono text-[10.5px] uppercase mb-1" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.08em' }}>
                          Advances when all of these hold
                        </p>
                        <ul className="space-y-1">
                          {p.exit_criteria.map((c, i) => (
                            <li key={i} className="flex gap-2">
                              <span style={{ color: 'var(--rc-ink-4)' }}>·</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {p.key_sessions?.length > 0 && (
                        <p style={{ color: 'var(--rc-ink-3)' }}><strong>Key sessions:</strong> {p.key_sessions.join('; ')}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-[13px] font-medium"
            style={{ color: 'var(--rc-blue-deep)' }}
          >
            {plan ? 'Design a new season (replaces this one) →' : 'Design a season →'}
          </button>
        )}

        {showForm && (
          <div className="space-y-3 pt-1">
            {plan && (
              <p className="text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>
                The current season is kept and marked superseded, not deleted — so you can still see why it changed.
              </p>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Goal">
                <input value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="21K trail race, 1300m gain" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Race date">
                <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Horizon (weeks)">
                <input type="number" min="4" max="104" value={horizonWeeks} onChange={(e) => setHorizonWeeks(e.target.value)} placeholder="auto from race date" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Race distance (km)">
                <input type="number" step="0.1" value={raceDistanceKm} onChange={(e) => setRaceDistanceKm(e.target.value)} placeholder="21" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Race elevation gain (m)">
                <input type="number" step="10" value={raceElevationGainM} onChange={(e) => setRaceElevationGainM(e.target.value)} placeholder="1300" className={INPUT} style={INPUT_STYLE} />
              </Field>
            </div>
            <Field label="Terrain you can train on">
              <input value={terrainAccess} onChange={(e) => setTerrainAccess(e.target.value)} placeholder="flat roads locally; hills 40 min drive; gym stairs + treadmill" className={INPUT} style={INPUT_STYLE} />
            </Field>

            {error && <p className="text-[12px]" style={{ color: 'oklch(0.5 0.18 25)' }}>{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={generate}
                disabled={generating || !goalName || !horizonWeeks}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-40"
                style={{ background: 'var(--rc-blue)', color: 'white' }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {generating ? 'Designing…' : 'Design season'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-[13px] font-medium"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>
              The season sets phase targets and exit criteria only — no daily workouts. Blocks are generated against it below.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const INPUT = 'w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2';
const INPUT_STYLE = { background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
