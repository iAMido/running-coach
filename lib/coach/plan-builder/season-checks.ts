/**
 * Rule checks for a SEASON (the macro plan) — pure, like ./checks.ts for a
 * block, so the same rules can score seasons from the old single-call route
 * and from the staged builder.
 *
 * A season is phases with weekly ranges and exit criteria, not workouts. The
 * rules are therefore about shape: does it cover the horizon and end on race
 * week, does it start from where the athlete actually is, does it progress
 * without leaps, does it ever reach what the race demands, and can each
 * phase's exit actually be measured.
 */

import { KPI_METRICS, type MacroPhase, type PhaseKpi } from '@/lib/coach/macro-plan';
import type { SeasonDraft, Violation } from './types';

export interface SeasonCheckContext {
  horizonWeeks: number;
  /** Weeks from the season start to race week; null without a race date. */
  weeksToRace: number | null;
  hasElevation: boolean;
  raceElevationGainM: number | null;
  vertPerKm: number | null;
  raceDistanceKm: number | null;
  athlete: { recentWeeklyKm: number | null; recentWeeklyVertM: number | null } | null;
}

/** Shortest phase that can build anything. A taper is exempt. */
const MIN_PHASE_WEEKS = 3;
/** Phase-to-phase jump in the LOW end of a weekly range. */
const KM_PHASE_JUMP = { warn: 1.2, error: 1.35 };
const VERT_PHASE_JUMP = { warn: 1.4, error: 1.75 };
/** First phase's low end against measured recent load. */
const START_KM = { warnPct: 0.2, warnAbs: 5, errorPct: 0.4, errorAbs: 10 };
/**
 * Climbing is the newer stress and carries the injury risk, so its start is
 * held tighter than km. Measured: the single-call season opened at 300 m/week
 * against his 198 m — +52% — which the head coach's review called a must-fix
 * on a plantar-fasciitis history while the first version of this rule
 * (error only past 3x) let it through.
 */
const START_VERT = { warnPct: 0.2, warnAbs: 50, errorPct: 0.4, errorAbs: 80 };
/**
 * Above this gradient the race demand block requires an explicit poles
 * decision (lib/ai/coach-prompts.ts buildRaceDemandBlock rule 5).
 */
const POLES_DECISION_VERT_PER_KM = 40;

const isTaper = (p: MacroPhase) => /taper|race[- ]?week|sharpen/i.test(`${p.name} ${p.focus}`);
const range = (r: unknown): [number, number] | null =>
  Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [r[0], r[1]] : null;

function over(v: number, ref: number, t: { warnPct: number; warnAbs: number; errorPct: number; errorAbs: number }): 'error' | 'warn' | null {
  if (v > Math.max(ref * (1 + t.errorPct), ref + t.errorAbs)) return 'error';
  if (v > Math.max(ref * (1 + t.warnPct), ref + t.warnAbs)) return 'warn';
  return null;
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

/** Keep only KPIs the app can evaluate; an unknown metric cannot be measured, so it is dropped (and the phase then fails the KPI-count rule). */
function kpisOf(x: unknown): PhaseKpi[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((k: Record<string, unknown>, i: number): PhaseKpi[] => {
    const metric = k.metric as PhaseKpi['metric'];
    const target = Number(k.target);
    if (!KPI_METRICS.includes(metric) || !Number.isFinite(target)) return [];
    const weeks = Number(k.consecutive_weeks);
    return [{
      id: String(k.id ?? `${metric}_${i + 1}`),
      label: String(k.label ?? metric),
      metric,
      comparator: k.comparator === 'lte' ? 'lte' : 'gte',
      target,
      ...(Number.isFinite(weeks) && weeks > 0 ? { consecutive_weeks: Math.round(weeks) } : {}),
    }];
  });
}

/** Validate the model's season; fatal problems mean it cannot be checked or saved. */
export function normalizeSeason(raw: unknown, goalName: string): { season: SeasonDraft | null; fatal: string[] } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fatal: string[] = [];
  const phases = (Array.isArray(o.phases) ? o.phases : []).map((p: Record<string, unknown>, i: number): MacroPhase => ({
    phase_number: i + 1,
    name: String(p.name ?? `Phase ${i + 1}`),
    focus: String(p.focus ?? ''),
    weeks: Math.round(Number(p.weeks)),
    weekly_km_range: range(p.weekly_km_range),
    weekly_vert_range_m: range(p.weekly_vert_range_m),
    long_run_vert_ceiling_m: typeof p.long_run_vert_ceiling_m === 'number' ? p.long_run_vert_ceiling_m : null,
    capability: String(p.capability ?? ''),
    exit_criteria: Array.isArray(p.exit_criteria) ? p.exit_criteria.map(String) : [],
    key_sessions: Array.isArray(p.key_sessions) ? p.key_sessions.map(String) : [],
    goal: typeof p.goal === 'string' ? p.goal : undefined,
    why_this_length: typeof p.why_this_length === 'string' ? p.why_this_length : undefined,
    must_haves: strs(p.must_haves),
    avoid: strs(p.avoid),
    watch_for: strs(p.watch_for),
    handoff: typeof p.handoff === 'string' ? p.handoff : undefined,
    kpis: kpisOf(p.kpis),
  }));
  if (phases.length === 0) fatal.push('the season has no phases');
  if (phases.some((p) => !Number.isFinite(p.weeks) || p.weeks < 1)) fatal.push('a phase has no valid length in weeks');
  if (fatal.length) return { season: null, fatal };
  return {
    season: {
      goal_name: String(o.goal_name ?? goalName),
      rationale: String(o.rationale ?? ''),
      phases,
      decisions: Array.isArray(o.decisions) ? o.decisions.map(String) : [],
    },
    fatal,
  };
}

/** `week` holds the PHASE number for season violations. */
export function checkSeason(s: SeasonDraft, ctx: SeasonCheckContext): Violation[] {
  const v: Violation[] = [];
  const add = (x: Violation) => v.push(x);
  const phases = s.phases;
  const total = phases.reduce((a, p) => a + p.weeks, 0);

  // --- coverage and race alignment -------------------------------------------
  const raceInHorizon = ctx.weeksToRace !== null && ctx.weeksToRace <= ctx.horizonWeeks + 1;
  const target = raceInHorizon ? ctx.weeksToRace! : ctx.horizonWeeks;
  if (Math.abs(total - target) >= 2) {
    add({ rule: 'season_length', severity: 'error', week: null,
      message: `Phases add up to ${total} weeks; the season must cover ${target} weeks${raceInHorizon ? ' (to race week)' : ''}.` });
  } else if (total !== target) {
    add({ rule: 'season_length', severity: 'warn', week: null, message: `Phases add up to ${total} weeks against ${target}.` });
  }
  if (raceInHorizon && phases.length > 0 && !isTaper(phases[phases.length - 1])) {
    add({ rule: 'season_taper', severity: 'error', week: phases.length,
      message: `The race falls inside this season but the final phase (${phases[phases.length - 1].name}) is not a taper.` });
  }

  phases.forEach((p, i) => {
    const n = p.phase_number;
    if (p.weeks < MIN_PHASE_WEEKS && !isTaper(p)) {
      add({ rule: 'phase_length', severity: p.weeks < 2 ? 'error' : 'warn', week: n,
        message: `${p.name} is ${p.weeks} week(s) — too short to build anything.` });
    }

    // --- ranges are usable -----------------------------------------------------
    const km = p.weekly_km_range;
    if (!km) add({ rule: 'km_range', severity: 'error', week: n, message: `${p.name} has no weekly km range.` });
    else if (km[0] > km[1] || km[0] <= 0) add({ rule: 'km_range', severity: 'error', week: n, message: `${p.name} km range ${km[0]}-${km[1]} is not a valid band.` });

    const vert = p.weekly_vert_range_m;
    if (ctx.hasElevation && !vert) {
      add({ rule: 'vert_range', severity: 'error', week: n, message: `${p.name} has no weekly climbing range on an elevation-targeted season.` });
    } else if (!ctx.hasElevation && vert) {
      add({ rule: 'vert_range', severity: 'warn', week: n, message: `${p.name} sets a climbing range although the goal has no elevation.` });
    } else if (vert && vert[0] > vert[1]) {
      add({ rule: 'vert_range', severity: 'error', week: n, message: `${p.name} climbing range ${vert[0]}-${vert[1]} is not a valid band.` });
    }

    // --- start from measured load ----------------------------------------------
    if (i === 0) {
      const rk = ctx.athlete?.recentWeeklyKm;
      if (km && rk) {
        const sev = over(km[0], rk, START_KM);
        if (sev) add({ rule: 'season_start_km', severity: sev, week: n,
          message: `${p.name} starts at ${km[0]} km/week; he has averaged ${rk} km over the last 4 weeks.` });
      }
      const rv = ctx.athlete?.recentWeeklyVertM;
      if (vert && rv !== null && rv !== undefined) {
        const sev = over(vert[0], rv, START_VERT);
        if (sev) add({ rule: 'season_start_vert', severity: sev, week: n,
          message: `${p.name} starts at ${vert[0]} m/week climbing; he has averaged ${rv} m recently.` });
      }
    }

    // --- phase to phase ----------------------------------------------------------
    if (i > 0 && !isTaper(p)) {
      const prev = phases[i - 1];
      const pk = prev.weekly_km_range, pv = prev.weekly_vert_range_m;
      if (km && pk && km[0] > pk[1] * KM_PHASE_JUMP.warn) {
        add({ rule: 'phase_jump_km', severity: km[0] > pk[1] * KM_PHASE_JUMP.error ? 'error' : 'warn', week: n,
          message: `${p.name} starts at ${km[0]} km/week, above the top of ${prev.name}'s range (${pk[1]}).` });
      }
      if (vert && pv && pv[1] > 0 && vert[0] > pv[1] * VERT_PHASE_JUMP.warn) {
        add({ rule: 'phase_jump_vert', severity: vert[0] > pv[1] * VERT_PHASE_JUMP.error ? 'error' : 'warn', week: n,
          message: `${p.name} starts at ${vert[0]} m/week, well above the top of ${prev.name}'s range (${pv[1]} m).` });
      }
    }

    // --- the brief: a goal and KPIs the app can measure ------------------------------
    if (!isTaper(p)) {
      if (!p.goal) add({ rule: 'phase_brief', severity: 'error', week: n, message: `${p.name} has no goal.` });
      if ((p.kpis?.length ?? 0) < 2) {
        add({ rule: 'phase_kpis', severity: 'error', week: n,
          message: `${p.name} has ${p.kpis?.length ?? 0} measurable KPI(s); it needs at least 2 the app can evaluate (${KPI_METRICS.join(', ')}).` });
      }
      if (!p.must_haves?.length || !p.avoid?.length || !p.watch_for?.length) {
        add({ rule: 'phase_brief', severity: 'warn', week: n, message: `${p.name}'s brief is missing must-haves, don'ts or warning signs.` });
      }
    }
    // A KPI the phase's own ranges cannot reach is a trap: the phase can never
    // be "done" by following it. The head coach's review found exactly this in
    // both the single-call and the staged seasons before this rule existed.
    for (const k of p.kpis ?? []) {
      if (k.comparator !== 'gte') continue;
      if (k.consecutive_weeks && k.consecutive_weeks > p.weeks) {
        add({ rule: 'kpi_reachable', severity: 'error', week: n,
          message: `KPI "${k.label}" needs ${k.consecutive_weeks} consecutive weeks in a ${p.weeks}-week phase.` });
      }
      if (k.metric === 'weekly_km' && km && k.target > km[1]) {
        add({ rule: 'kpi_reachable', severity: 'error', week: n,
          message: `KPI "${k.label}" targets ${k.target} km/week, above ${p.name}'s own range (${km[0]}-${km[1]}).` });
      }
      if (k.metric === 'weekly_vert_m' && vert && k.target > vert[1]) {
        add({ rule: 'kpi_reachable', severity: 'error', week: n,
          message: `KPI "${k.label}" targets ${k.target} m/week, above ${p.name}'s own climbing range (${vert[0]}-${vert[1]}).` });
      }
      if (k.metric === 'session_vert_m') {
        const cap = p.long_run_vert_ceiling_m ?? vert?.[1] ?? null;
        if (cap !== null && k.target > cap) {
          add({ rule: 'kpi_reachable', severity: 'error', week: n,
            message: `KPI "${k.label}" asks for a ${k.target} m single climb; ${p.name} caps a single session at ${cap} m.` });
        }
      }
    }

    // --- exit criteria can be measured ---------------------------------------------
    if (p.exit_criteria.length === 0) {
      add({ rule: 'exit_criteria', severity: 'error', week: n, message: `${p.name} has no exit criteria — nothing says when to advance.` });
    } else if (!isTaper(p) && p.exit_criteria.every((c) => !/\d/.test(c))) {
      add({ rule: 'exit_criteria', severity: 'warn', week: n, message: `${p.name}'s exit criteria contain no number anything can measure.` });
    }
    for (const c of p.exit_criteria) {
      if (/decoupl/i.test(c) && /[<≤]\s*[58]\s*%|below\s*[58]\s*%|under\s*[58]\s*%/i.test(c)) {
        add({ rule: 'absolute_decoupling', severity: 'error', week: n,
          message: `"${c}" uses an absolute decoupling band; use his own percentile (his median is ~6.5%).` });
      }
    }
  });

  // --- does the season ever reach the race's demand? ---------------------------------
  if (ctx.hasElevation && ctx.raceElevationGainM) {
    const peak = Math.max(0, ...phases.map((p) => p.weekly_vert_range_m?.[1] ?? 0));
    const endsBeforeRace = !raceInHorizon;
    if (!endsBeforeRace && peak < ctx.raceElevationGainM) {
      add({ rule: 'reaches_race_vert', severity: 'error', week: null,
        message: `Peak weekly climbing is ${peak} m; the race itself climbs ${ctx.raceElevationGainM} m. The season never trains a race-sized week.` });
    }
  }
  if (ctx.raceDistanceKm && raceInHorizon) {
    const peakKm = Math.max(0, ...phases.map((p) => p.weekly_km_range?.[1] ?? 0));
    if (peakKm < ctx.raceDistanceKm * 1.3) {
      add({ rule: 'reaches_race_km', severity: 'warn', week: null,
        message: `Peak weekly volume is ${peakKm} km for a ${ctx.raceDistanceKm} km race.` });
    }
  }
  if ((ctx.vertPerKm ?? 0) >= POLES_DECISION_VERT_PER_KM) {
    const text = `${s.rationale} ${s.decisions.join(' ')} ${phases.map((p) => `${p.focus} ${p.key_sessions.join(' ')} ${p.exit_criteria.join(' ')}`).join(' ')}`;
    if (!/\bpoles?\b/i.test(text)) {
      add({ rule: 'poles_decision', severity: 'error', week: null,
        message: `At ${ctx.vertPerKm} m/km the season must decide on poles (yes or no, and which phase they enter); it never mentions them.` });
    }
  }
  return v;
}

/** One line per phase, for the reviewer and the fix prompt. */
export function renderSeason(s: SeasonDraft): string {
  return s.phases.map((p) =>
    `P${p.phase_number} ${p.name} · ${p.weeks} wk · ${p.weekly_km_range?.join('-') ?? '?'} km/wk` +
    (p.weekly_vert_range_m ? ` · ${p.weekly_vert_range_m.join('-')} m/wk` : '') +
    (p.long_run_vert_ceiling_m != null ? ` · long-run climb ≤${p.long_run_vert_ceiling_m} m` : '') +
    `\n  goal: ${p.goal ?? '—'}${p.why_this_length ? ` (length: ${p.why_this_length})` : ''}` +
    `\n  focus: ${p.focus}\n  capability: ${p.capability}\n  key sessions: ${p.key_sessions.join('; ')}` +
    `\n  KPIs: ${(p.kpis ?? []).map((k) => `${k.label} [${k.metric} ${k.comparator === 'gte' ? '≥' : '≤'} ${k.target}${k.consecutive_weeks ? ` x${k.consecutive_weeks} wk` : ''}]`).join('; ') || 'none'}` +
    `\n  must: ${(p.must_haves ?? []).join('; ') || '—'}\n  avoid: ${(p.avoid ?? []).join('; ') || '—'}\n  watch for: ${(p.watch_for ?? []).join('; ') || '—'}` +
    `\n  hand-over: ${p.handoff ?? '—'}\n  exit: ${p.exit_criteria.join(' | ')}`,
  ).join('\n');
}
