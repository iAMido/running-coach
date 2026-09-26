/**
 * Phase KPIs: what each measurable target reads today, from the athlete's own
 * data. The weekly reviewer and the Saturday proposal steer toward whichever
 * KPI lags; `recommend` (./season-progress.ts) uses them to decide whether a
 * phase is done.
 *
 * `evaluateKpis` is pure; `loadKpiData` fetches. A KPI that cannot be measured
 * returns `current: null` — never a zero, never a pass. Indoor incline work
 * commonly records 0 m, so weekly climbing KPIs say "logged" and the caveat is
 * carried in the detail rather than hidden.
 */

import { supabase } from '@/lib/db/supabase';
import { userDateStr, utcFromUserLocal } from '@/lib/utils/user-time';
import { percentileOf, medianOf } from '@/lib/utils/decoupling';
import type { PhaseKpi } from '@/lib/coach/macro-plan';

export interface KpiRun {
  /** YYYY-MM-DD in the athlete's timezone. */
  date: string;
  distance_km: number;
  elevation_gain_m: number | null;
  decoupling_pct: number | null;
}

export interface KpiData {
  today: string;
  /** Runs since the phase started. */
  runs: KpiRun[];
  /** His whole decoupling history — the percentile reference. */
  decouplingHistory: number[];
  trainingDays: string[] | null;
  ctl: number | null;
  form: number | null;
}

export interface KpiStatus {
  kpi: PhaseKpi;
  current: number | null;
  met: boolean;
  trend: 'up' | 'down' | 'flat' | null;
  detail: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const sundayOf = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - dow(iso) * 86_400_000).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const ok = (v: number, k: PhaseKpi) => (k.comparator === 'gte' ? v >= k.target : v <= k.target);

/** Complete Sun-Sat weeks only — a week in progress is real but not comparable. */
function weekly(runs: KpiRun[], today: string, pick: (r: KpiRun) => number | null) {
  const buckets = new Map<string, { value: number; measured: boolean }>();
  for (const r of runs) {
    const wk = sundayOf(r.date);
    const b = buckets.get(wk) ?? { value: 0, measured: false };
    const v = pick(r);
    if (v !== null) { b.value += v; b.measured = true; }
    buckets.set(wk, b);
  }
  const thisWeek = sundayOf(today);
  return [...buckets.entries()].filter(([wk]) => wk < thisWeek).sort(([a], [b]) => a.localeCompare(b)).map(([week, b]) => ({ week, ...b }));
}

function trendOf(values: number[]): KpiStatus['trend'] {
  if (values.length < 4) return null;
  const recent = (values[values.length - 1] + values[values.length - 2]) / 2;
  const prior = (values[values.length - 3] + values[values.length - 4]) / 2;
  if (prior === 0) return null;
  const change = (recent - prior) / Math.abs(prior);
  return change > 0.1 ? 'up' : change < -0.1 ? 'down' : 'flat';
}

export function evaluateKpis(kpis: PhaseKpi[], d: KpiData): KpiStatus[] {
  return kpis.map((kpi): KpiStatus => {
    switch (kpi.metric) {
      case 'weekly_km':
      case 'weekly_vert_m': {
        const isVert = kpi.metric === 'weekly_vert_m';
        const weeks = weekly(d.runs, d.today, (r) => (isVert ? r.elevation_gain_m : r.distance_km))
          .filter((w) => !isVert || w.measured);
        if (weeks.length === 0) return { kpi, current: null, met: false, trend: null, detail: 'no complete week yet' };
        const need = Math.max(1, kpi.consecutive_weeks ?? 1);
        let streak = 0, best = 0;
        for (const w of weeks) { streak = ok(w.value, kpi) ? streak + 1 : 0; best = Math.max(best, streak); }
        const last = r1(weeks[weeks.length - 1].value);
        return {
          kpi, current: last, met: best >= need, trend: trendOf(weeks.map((w) => w.value)),
          detail: `last complete week ${last}${isVert ? ' m (logged)' : ' km'} · ${streak} week(s) in a row on target, best ${best} of ${need} needed`,
        };
      }
      case 'long_run_km':
      case 'session_vert_m': {
        const vals = d.runs.map((r) => (kpi.metric === 'long_run_km' ? r.distance_km : r.elevation_gain_m)).filter((v): v is number => v !== null);
        if (vals.length === 0) return { kpi, current: null, met: false, trend: null, detail: 'no measured run in this phase yet' };
        const best = r1(kpi.comparator === 'gte' ? Math.max(...vals) : Math.min(...vals));
        return { kpi, current: best, met: ok(best, kpi), trend: null, detail: `best single run so far: ${best}${kpi.metric === 'long_run_km' ? ' km' : ' m'}` };
      }
      case 'adherence_pct': {
        if (!d.trainingDays || d.runs.length === 0) return { kpi, current: null, met: false, trend: null, detail: d.trainingDays ? 'no runs yet' : 'training days not stated' };
        const on = d.runs.filter((r) => d.trainingDays!.includes(DAYS[dow(r.date)])).length;
        const pct = Math.round((100 * on) / d.runs.length);
        return { kpi, current: pct, met: ok(pct, kpi), trend: null, detail: `${on} of ${d.runs.length} runs on stated days` };
      }
      case 'decoupling_pctile': {
        const vals = d.runs.map((r) => r.decoupling_pct).filter((v): v is number => v !== null);
        const med = medianOf(vals);
        const pct = med === null ? null : percentileOf(med, d.decouplingHistory);
        if (pct === null) return { kpi, current: null, met: false, trend: null, detail: `${vals.length} run(s) with decoupling in this phase — too few to judge` };
        return { kpi, current: Math.round(pct), met: ok(pct, kpi), trend: null, detail: `phase median ${r1(med!)}% = percentile ${Math.round(pct)} of his own history (${vals.length} runs)` };
      }
      case 'form':
      case 'ctl': {
        const v = kpi.metric === 'form' ? d.form : d.ctl;
        if (v === null) return { kpi, current: null, met: false, trend: null, detail: 'no recent CTL/ATL' };
        return { kpi, current: r1(v), met: ok(v, kpi), trend: null, detail: `latest ${kpi.metric.toUpperCase()} ${r1(v)}` };
      }
    }
  });
}

/** Everything `evaluateKpis` needs, for the window starting `since` (YYYY-MM-DD). */
export async function loadKpiData(
  userId: string, since: string, trainingDays: string[] | null, load: { ctl: number | null; form: number | null },
): Promise<KpiData> {
  const [{ data: runs }, { data: history }] = await Promise.all([
    supabase.from('runs').select('date, distance_km, elevation_gain_m, decoupling_pct')
      .eq('user_id', userId).gte('date', utcFromUserLocal(`${since}T00:00:00`)).order('date', { ascending: true }),
    supabase.from('runs').select('decoupling_pct').eq('user_id', userId).not('decoupling_pct', 'is', null),
  ]);
  return {
    today: userDateStr(),
    runs: (runs ?? []).map((r: { date: string; distance_km: number; elevation_gain_m: number | null; decoupling_pct: number | null }) => ({
      // Day of the run in HIS timezone — a 22:30 run belongs to that day's week.
      date: userDateStr(new Date(r.date)),
      distance_km: Number(r.distance_km) || 0,
      elevation_gain_m: r.elevation_gain_m === null ? null : Number(r.elevation_gain_m),
      decoupling_pct: r.decoupling_pct === null ? null : Number(r.decoupling_pct),
    })),
    decouplingHistory: (history ?? []).map((r: { decoupling_pct: number }) => Number(r.decoupling_pct)),
    trainingDays,
    ctl: load.ctl,
    form: load.form,
  };
}

/** The KPI table for the weekly reviewer and the Saturday proposal. */
export function formatKpiStatus(phaseName: string, goal: string | undefined, statuses: KpiStatus[], week: string): string {
  if (statuses.length === 0) return '';
  const rows = statuses.map((s) =>
    `| ${s.kpi.label} | ${s.kpi.comparator === 'gte' ? '≥' : '≤'} ${s.kpi.target} | ${s.current ?? 'not measured'} | ${s.current === null ? '—' : s.met ? 'MET' : 'behind'}${s.trend ? ` (${s.trend})` : ''} | ${s.detail} |`);
  return [
    `## PHASE KPIs — ${phaseName} (${week})`,
    goal ? `Phase goal: ${goal}` : '',
    '| KPI | Target | Now | Status | Detail |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    'Steer the coming week toward the KPIs that are behind, within the phase ranges and the plan. Name which KPI each change serves. A KPI marked "not measured" is unknown — do not treat it as met or missed.',
  ].filter(Boolean).join('\n');
}
