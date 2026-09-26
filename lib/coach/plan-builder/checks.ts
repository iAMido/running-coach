/**
 * Step 6 (rule checks) and the measurable half of step 7 (does it all fit).
 *
 * Pure functions over the plan JSON — no model, no database — so every rule
 * is testable, and the same checker scores plans from the old single-call
 * generator, which is the only honest way to say the staged builder is
 * better rather than merely newer.
 *
 * A rule reports what is wrong precisely enough to hand straight back to a
 * writer as a fix: week, day, the number found and the number allowed.
 *
 * Severity:
 * - `error` — the plan is wrong in a way that would hurt or mislead: a run
 *   on a day he does not train, a 30% volume jump, strength on the long-run
 *   day, a "recovery" week that is harder than the one before. Errors are
 *   repaired before saving.
 * - `warn` — worth knowing, not worth a rewrite: a long run a little off its
 *   target, two hard days back to back. Saved with the plan as notes.
 */

import type { PlanWeek, Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';
import { TREADMILL_VERT_TABLE, treadmillVertPerHour } from '@/lib/utils/elevation';
import type { CoherenceIssue, PlanOutline, Violation } from './types';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ---------------------------------------------------------------------------
// Thresholds. Named so the numbers are visible and argued once.
// ---------------------------------------------------------------------------

/**
 * Week-on-week volume growth. The classic 10% rule, with an absolute floor:
 * at 20 km/week 10% is 2 km, less than one short run, so a strict percentage
 * forbids ordinary progression at low volume. Error only well past it.
 */
const KM_RAMP = { warnPct: 0.10, warnAbs: 3, errorPct: 0.20, errorAbs: 6 };
/**
 * Climbing is the newer stress and the injury risk for this athlete, but it
 * starts from a low base where a single hill session doubles the week, so the
 * absolute floor matters more than for km.
 */
const VERT_RAMP = { warnPct: 0.15, warnAbs: 100, errorPct: 0.35, errorAbs: 250 };
/** Week 1 against what he actually ran in the last 4 complete weeks. */
const START_KM = { warnPct: 0.15, warnAbs: 5, errorPct: 0.35, errorAbs: 10 };
const START_VERT = { warnPct: 0.5, warnAbs: 150, errorPct: 1.0, errorAbs: 350 };
/** A recovery week must actually be lighter than the week before it. */
const RECOVERY_MAX_RATIO = { warn: 0.9, error: 1.0 };
/** Race week against the plan's peak week. */
const TAPER_MAX_RATIO = { warn: 0.75, error: 0.9 };
/** Week totals against the outline the week was written from. */
const OUTLINE_KM = { warn: 0.10, error: 0.20 };
const OUTLINE_VERT = { warn: 0.15, error: 0.30 };
/**
 * Sum of a week's run distances against its stated total. Writers are told
 * ±10%; past 12% the stated total misstates the load every other rule reads
 * (the first staged build said 27 km for sessions adding to 31).
 */
const SUM_MISMATCH = { warn: 0.08, error: 0.12 };
/** Sum of a week's session climbs against its stated climbing total. */
const VERT_SUM_MISMATCH = { warn: 0.15, error: 0.25 };
/**
 * Incline work whose stated metres fall short of grade × speed × time. The
 * head coach's first review found treadmill sessions labelled at a third of
 * what they climb — "30 min at 10-12%" as +18 m — so every weekly climbing
 * cap, the plan's main protection for a plantar-fasciitis history, was
 * silently broken. Arithmetic belongs in code, not in a reviewer's reading.
 */
const INCLINE_UNDERCOUNT = { ratio: 1.25, slackM: 40 };
/**
 * bpm a written range may sit outside its own zone label. Past `error` it is
 * repaired, not noted: the label is later compared against what he actually
 * ran (lib/utils/zone-discipline.ts), so "Z1-Z2 (130-150)" — 150 is Z3 — turns
 * a correctly executed session into a false "ran too hard". The single-call
 * generator did this 23 times in one 12-week plan.
 */
const HR_TOLERANCE = { warn: 3, error: 5 };

// ---------------------------------------------------------------------------
// Reading workouts
// ---------------------------------------------------------------------------

/** "7 km", "7km", "10-12 km", "8.5 km" → km. Null when no km figure is stated. */
export function parseKm(s: string | undefined | null): number | null {
  if (!s) return null;
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*km/i);
  if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
  const single = s.match(/(\d+(?:\.\d+)?)\s*km/i);
  return single ? parseFloat(single[1]) : null;
}

const NOT_A_RUN = /\b(rest|off|day off|strength only|gym only|mobility only|cross[- ]?train|swim|bike|cycling)\b/i;
const QUALITY = /tempo|threshold|interval|vo2|repeat|hill rep|fartlek|race[- ]pace|progression|stairs|lt[12]\b|cruise|speed|strides only/i;
const LONG = /long/i;

export function isRun(w: Workout | undefined | null): boolean {
  if (!w || !w.type) return false;
  if (NOT_A_RUN.test(w.type)) return false;
  // "Strength" alone is a gym session; "Easy Run + Strength" is a run.
  if (/^\s*strength\b/i.test(w.type) && !/run|hike|jog/i.test(w.type)) return false;
  return true;
}

export function isQuality(w: Workout): boolean {
  return isRun(w) && QUALITY.test(w.type);
}

function runsOf(week: PlanWeek): [string, Workout][] {
  return Object.entries(week.workouts ?? {}).filter(([, w]) => isRun(w));
}

/** The long run: the session typed "Long", else the longest by km. */
export function longRunOf(week: PlanWeek): { day: string; km: number | null } | null {
  const runs = runsOf(week);
  if (runs.length === 0) return null;
  const typed = runs.filter(([, w]) => LONG.test(w.type));
  const pool = typed.length > 0 ? typed : runs;
  let best: [string, Workout] | null = null;
  let bestKm = -1;
  for (const r of pool) {
    const km = parseKm(r[1].distance) ?? -1;
    if (km > bestKm) { best = r; bestKm = km; }
  }
  return best ? { day: best[0], km: bestKm >= 0 ? bestKm : null } : null;
}

function isRecoveryWeek(week: PlanWeek, outline?: PlanOutline | null): boolean {
  const o = outline?.weeks.find((x) => x.week === week.week_number);
  if (o) return o.is_recovery;
  return /recovery|deload|down week|absorb/i.test(`${week.phase} ${week.focus}`);
}

function isTaperWeek(week: PlanWeek): boolean {
  return /taper|race week/i.test(`${week.phase} ${week.focus}`);
}

function strengthOf(w: Workout): unknown {
  return (w as { strength?: unknown }).strength;
}

/** Zone labels in "Z1-Z2 (120-140)" and the bpm range written beside them. */
export function parseTargetHr(s: string | undefined): { zones: number[]; bpm: [number, number] | null } | null {
  if (!s) return null;
  const zs = [...s.matchAll(/z\s*([1-6])/gi)].map((m) => parseInt(m[1], 10));
  if (zs.length === 0) return null;
  const bpm = s.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})/);
  const lo = Math.min(...zs), hi = Math.max(...zs);
  return {
    zones: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
    bpm: bpm ? [parseInt(bpm[1], 10), parseInt(bpm[2], 10)] : null,
  };
}

/** Default treadmill speed for a grade: the nearest row of the vert table. */
function defaultSpeedFor(grade: number): number {
  let best = TREADMILL_VERT_TABLE[0];
  for (const r of TREADMILL_VERT_TABLE) if (Math.abs(r.gradePercent - grade) < Math.abs(best.gradePercent - grade)) best = r;
  return best.speedKmh;
}

/**
 * Metres climbed by the incline work written in a session description, or
 * null when it names none. Reads the forms writers use: "20min at 10%/5.5km/h",
 * "5x5 min @10-12%", "15min hike at 12% incline". A segment counts only when
 * it states both minutes and a grade (3-25%), so "85% HR" or "80/20" do not.
 */
export function inclineVertFromDescription(desc: string | undefined | null): number | null {
  if (!desc) return null;
  let total = 0;
  let found = false;
  // Segments split on | + ; — NOT commas: "30 min at 11%, 3.5 km/h" keeps its
  // speed with its grade. Splitting on the comma dropped the speed, fell back
  // to the table's 5.5 km/h and overstated the climb 57% (caught by the head
  // coach's review on the second staged build).
  for (const seg of desc.split(/[|+;]/)) {
    const grade = seg.match(/(?:at|@)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%/i)
      ?? seg.match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%\s*(?:grade|incline)/i);
    if (!grade) continue;
    const g = grade[2] ? (parseFloat(grade[1]) + parseFloat(grade[2])) / 2 : parseFloat(grade[1]);
    if (g < 3 || g > 25) continue;
    const reps = seg.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*min/i);
    const single = seg.match(/(\d+(?:\.\d+)?)\s*min/i);
    const minutes = reps ? parseInt(reps[1], 10) * parseFloat(reps[2]) : single ? parseFloat(single[1]) : null;
    if (!minutes) continue;
    const speed = seg.match(/(\d+(?:\.\d+)?)\s*km\/?h/i);
    total += treadmillVertPerHour(g, speed ? parseFloat(speed[1]) : defaultSpeedFor(g)) * minutes / 60;
    found = true;
  }
  return found ? Math.round(total) : null;
}

// ---------------------------------------------------------------------------
// Step 6 — rule checks
// ---------------------------------------------------------------------------

export interface CheckContext {
  expectedWeeks: number;
  /** Null = the days were not stated; the day rule is then skipped, not passed. */
  allowedDays: string[] | null;
  runsPerWeek: number;
  hasElevation: boolean;
  /** True when the plan ends in a race — enables the taper rule. */
  hasRace: boolean;
  outline?: PlanOutline | null;
  athlete?: { recentWeeklyKm: number | null; recentWeeklyVertM: number | null } | null;
  zones?: ZoneBands | null;
  /**
   * Strength session ids the plan may reference. Checked BEFORE references
   * are expanded, so a dangling id is caught here rather than silently
   * dropped at save time.
   */
  strengthLibrary?: string[] | null;
}

function over(value: number, ref: number, t: { warnPct: number; warnAbs: number; errorPct: number; errorAbs: number }): Severity | null {
  if (value > Math.max(ref * (1 + t.errorPct), ref + t.errorAbs)) return 'error';
  if (value > Math.max(ref * (1 + t.warnPct), ref + t.warnAbs)) return 'warn';
  return null;
}
type Severity = 'error' | 'warn';

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export function checkPlan(weeks: PlanWeek[], ctx: CheckContext): Violation[] {
  const v: Violation[] = [];
  const add = (x: Violation) => v.push(x);
  const sorted = [...weeks].sort((a, b) => a.week_number - b.week_number);

  // --- completeness --------------------------------------------------------
  const seen = new Set(sorted.map((w) => w.week_number));
  for (let n = 1; n <= ctx.expectedWeeks; n++) {
    if (!seen.has(n)) add({ rule: 'weeks_complete', severity: 'error', week: n, message: `Week ${n} is missing.` });
  }
  if (sorted.length > ctx.expectedWeeks) {
    add({ rule: 'weeks_complete', severity: 'error', week: null, message: `${sorted.length} weeks returned; ${ctx.expectedWeeks} were requested.` });
  }

  const peakKm = Math.max(0, ...sorted.map((w) => w.total_km || 0));

  sorted.forEach((week, i) => {
    const n = week.week_number;
    const workouts = week.workouts ?? {};
    const runs = runsOf(week);
    const recovery = isRecoveryWeek(week, ctx.outline);
    const taper = isTaperWeek(week) || (ctx.hasRace && n === ctx.expectedWeeks);

    // --- days --------------------------------------------------------------
    for (const [day, w] of Object.entries(workouts)) {
      if (!(DAYS as readonly string[]).includes(day)) {
        add({ rule: 'valid_day', severity: 'error', week: n, day, message: `"${day}" is not a weekday name.` });
        continue;
      }
      const scheduled = isRun(w) || !!strengthOf(w);
      if (ctx.allowedDays && scheduled && !ctx.allowedDays.includes(day)) {
        add({ rule: 'training_days', severity: 'error', week: n, day,
          message: `${w.type} on ${day}, which is not one of his training days (${ctx.allowedDays.join(', ')}).` });
      }
    }

    // --- runs per week -----------------------------------------------------
    if (runs.length > ctx.runsPerWeek) {
      add({ rule: 'runs_per_week', severity: 'error', week: n,
        message: `${runs.length} runs scheduled; he asked for ${ctx.runsPerWeek} per week.` });
    } else if (runs.length < ctx.runsPerWeek - 1 && !recovery && !taper) {
      add({ rule: 'runs_per_week', severity: 'warn', week: n,
        message: `Only ${runs.length} runs in a normal week; he asked for ${ctx.runsPerWeek}.` });
    }

    // --- stated total vs the sessions that make it up ------------------------
    const kms = runs.map(([, w]) => parseKm(w.distance));
    if (week.total_km > 0 && kms.length > 0 && kms.every((k) => k !== null)) {
      const sum = (kms as number[]).reduce((a, b) => a + b, 0);
      const diff = Math.abs(sum - week.total_km) / week.total_km;
      if (diff > SUM_MISMATCH.warn) {
        add({ rule: 'total_matches_sessions', severity: diff > SUM_MISMATCH.error ? 'error' : 'warn', week: n,
          message: `Sessions add up to ${fmt(sum)} km but the week says ${fmt(week.total_km)} km.` });
      }
    }

    // --- volume ramp -------------------------------------------------------
    if (i === 0) {
      const recent = ctx.athlete?.recentWeeklyKm;
      if (recent && recent > 0) {
        const s = over(week.total_km, recent, START_KM);
        if (s) add({ rule: 'start_volume', severity: s, week: n,
          message: `Week 1 is ${fmt(week.total_km)} km; he has averaged ${fmt(recent)} km over the last 4 weeks.` });
      }
    } else if (!recovery) {
      // Reference is the biggest of the previous 3 non-recovery weeks, so
      // returning to load after a down week is not read as a jump.
      const prior = sorted.slice(Math.max(0, i - 3), i).filter((w) => !isRecoveryWeek(w, ctx.outline));
      const ref = prior.length ? Math.max(...prior.map((w) => w.total_km || 0)) : sorted[i - 1].total_km;
      if (ref > 0) {
        const s = over(week.total_km, ref, KM_RAMP);
        if (s) add({ rule: 'volume_ramp', severity: s, week: n,
          message: `Volume rises to ${fmt(week.total_km)} km from ${fmt(ref)} km (+${Math.round((week.total_km / ref - 1) * 100)}%).` });
      }
    }

    // --- climbing ------------------------------------------------------------
    if (ctx.hasElevation) {
      const vert = week.total_elevation_gain_m;
      if (vert === undefined || vert === null) {
        add({ rule: 'elevation_present', severity: 'error', week: n, message: 'No weekly climbing target on an elevation-targeted plan.' });
      } else if (i === 0) {
        const recent = ctx.athlete?.recentWeeklyVertM;
        if (recent !== null && recent !== undefined && recent >= 0) {
          const s = over(vert, recent, START_VERT);
          if (s) add({ rule: 'start_vert', severity: s, week: n,
            message: `Week 1 climbs ${Math.round(vert)} m; he has averaged ${Math.round(recent)} m/week recently.` });
        }
      } else if (!recovery) {
        const prior = sorted.slice(Math.max(0, i - 3), i).filter((w) => !isRecoveryWeek(w, ctx.outline));
        const refs = prior.map((w) => w.total_elevation_gain_m).filter((x): x is number => typeof x === 'number');
        const ref = refs.length ? Math.max(...refs) : null;
        if (ref !== null && ref > 0) {
          const s = over(vert, ref, VERT_RAMP);
          if (s) add({ rule: 'vert_ramp', severity: s, week: n,
            message: `Climbing rises to ${Math.round(vert)} m from ${Math.round(ref)} m (+${Math.round((vert / ref - 1) * 100)}%).` });
        }
      }
      for (const [day, w] of runs) {
        if (w.elevation_gain_m === undefined || w.elevation_gain_m === null) {
          add({ rule: 'elevation_present', severity: 'warn', week: n, day, message: `${w.type} on ${day} has no climbing target.` });
        }
        const incline = inclineVertFromDescription(w.description);
        const labelled = w.elevation_gain_m ?? 0;
        if (incline !== null && incline > labelled * INCLINE_UNDERCOUNT.ratio + INCLINE_UNDERCOUNT.slackM) {
          add({ rule: 'incline_vert_math', severity: 'error', week: n, day,
            message: `"${w.description}" climbs about ${incline} m (grade x speed x time) but is labelled ${Math.round(labelled)} m. Label the true metres, and resize the session if that breaks the week's climbing target.` });
        }
      }
      const sessionVert = runs.map(([, w]) => w.elevation_gain_m);
      if (typeof vert === 'number' && vert > 0 && sessionVert.every((x) => typeof x === 'number')) {
        const sum = (sessionVert as number[]).reduce((a, b) => a + b, 0);
        const diff = Math.abs(sum - vert) / vert;
        if (diff > VERT_SUM_MISMATCH.warn) {
          add({ rule: 'vert_total_matches_sessions', severity: diff > VERT_SUM_MISMATCH.error ? 'error' : 'warn', week: n,
            message: `Sessions climb ${Math.round(sum)} m but the week says ${Math.round(vert)} m.` });
        }
      }
    }

    // --- recovery weeks are actually lighter --------------------------------
    if (recovery && i > 0) {
      const prev = sorted[i - 1];
      if (prev.total_km > 0) {
        const r = week.total_km / prev.total_km;
        if (r >= RECOVERY_MAX_RATIO.warn) {
          add({ rule: 'recovery_is_lighter', severity: r >= RECOVERY_MAX_RATIO.error ? 'error' : 'warn', week: n,
            message: `Recovery week is ${fmt(week.total_km)} km against ${fmt(prev.total_km)} km the week before.` });
        }
      }
      const pv = prev.total_elevation_gain_m, wv = week.total_elevation_gain_m;
      if (ctx.hasElevation && typeof pv === 'number' && typeof wv === 'number' && pv > 0 && wv >= pv) {
        add({ rule: 'recovery_is_lighter', severity: 'error', week: n,
          message: `Recovery week climbs ${Math.round(wv)} m, no less than the ${Math.round(pv)} m before it. Cut climbing first in a down week.` });
      }
    }

    // --- taper ---------------------------------------------------------------
    if (ctx.hasRace && n === ctx.expectedWeeks && peakKm > 0) {
      const r = week.total_km / peakKm;
      if (r > TAPER_MAX_RATIO.warn) {
        add({ rule: 'taper', severity: r > TAPER_MAX_RATIO.error ? 'error' : 'warn', week: n,
          message: `Race week is ${fmt(week.total_km)} km, ${Math.round(r * 100)}% of the ${fmt(peakKm)} km peak.` });
      }
    }

    // --- the long run ----------------------------------------------------------
    const long = longRunOf(week);
    const longRole = ctx.outline ? Object.entries(ctx.outline.day_roles ?? {}).find(([, r]) => /long/i.test(r))?.[0] : undefined;
    if (long && longRole && long.day !== longRole && !taper) {
      add({ rule: 'long_run_day', severity: 'warn', week: n, day: long.day,
        message: `Long run is on ${long.day}; the outline gives the long run to ${longRole}.` });
    }

    // --- strength placement and references -------------------------------------
    const longDay = long?.day;
    const longIdx = longDay ? DAYS.indexOf(longDay as (typeof DAYS)[number]) : -1;
    for (const [day, w] of Object.entries(workouts)) {
      const s = strengthOf(w);
      if (!s) continue;
      if (typeof s === 'string' && ctx.strengthLibrary && !ctx.strengthLibrary.includes(s)) {
        add({ rule: 'strength_reference', severity: 'error', week: n, day,
          message: `Strength "${s}" is not defined in the outline's strength library (${ctx.strengthLibrary.join(', ')}).` });
      }
      if (runs.length > 1 && day === longDay) {
        add({ rule: 'strength_placement', severity: 'error', week: n, day,
          message: `Strength on the long-run day (${day}). Every reference plan keeps these apart.` });
      } else if (runs.length > 1 && longIdx > 0 && DAYS.indexOf(day as (typeof DAYS)[number]) === longIdx - 1) {
        add({ rule: 'strength_placement', severity: 'error', week: n, day,
          message: `Strength on ${day}, the day before the long run (${longDay}).` });
      }
    }
    const o = ctx.outline?.weeks.find((x) => x.week === n);
    if (o) {
      const count = Object.values(workouts).filter((w) => !!strengthOf(w)).length;
      if (count !== o.strength.length) {
        add({ rule: 'strength_count', severity: 'warn', week: n,
          message: `${count} strength sessions; the outline planned ${o.strength.length}.` });
      }
    }

    // --- hard / easy -------------------------------------------------------------
    const hardDays = DAYS.map((d) => {
      const w = workouts[d];
      return !!w && (isQuality(w) || (longDay === d && runs.length > 1));
    });
    for (let d = 1; d < 7; d++) {
      if (hardDays[d] && hardDays[d - 1]) {
        add({ rule: 'hard_easy', severity: 'warn', week: n, day: DAYS[d],
          message: `Hard sessions on consecutive days (${DAYS[d - 1]}, ${DAYS[d]}).` });
      }
    }

    // --- against the outline -------------------------------------------------------
    if (o) {
      if (o.total_km > 0) {
        const d = Math.abs(week.total_km - o.total_km) / o.total_km;
        if (d > OUTLINE_KM.warn) add({ rule: 'outline_km', severity: d > OUTLINE_KM.error ? 'error' : 'warn', week: n,
          message: `${fmt(week.total_km)} km; the outline set ${fmt(o.total_km)} km for this week.` });
      }
      const ov = o.total_elevation_gain_m, wv = week.total_elevation_gain_m;
      if (ctx.hasElevation && typeof ov === 'number' && ov > 0 && typeof wv === 'number') {
        const d = Math.abs(wv - ov) / ov;
        if (d > OUTLINE_VERT.warn) add({ rule: 'outline_vert', severity: d > OUTLINE_VERT.error ? 'error' : 'warn', week: n,
          message: `${Math.round(wv)} m climbing; the outline set ${Math.round(ov)} m.` });
      }
      if (long?.km && o.long_run_km > 0 && Math.abs(long.km - o.long_run_km) / o.long_run_km > 0.2) {
        add({ rule: 'outline_long_run', severity: 'warn', week: n,
          message: `Long run ${fmt(long.km)} km; the outline set ${fmt(o.long_run_km)} km.` });
      }
    }

    // --- zone label vs bpm -----------------------------------------------------------
    if (ctx.zones) {
      for (const [day, w] of runs) {
        const t = parseTargetHr(w.target_hr);
        if (!t?.bpm) continue;
        const bands = t.zones.map((z) => ctx.zones![`z${z}` as keyof ZoneBands]);
        const lo = Math.min(...bands.map((b) => b.low)), hi = Math.max(...bands.map((b) => b.high));
        const outside = Math.max(lo - t.bpm[0], t.bpm[1] - hi);
        if (outside > HR_TOLERANCE.warn) {
          add({ rule: 'hr_label', severity: outside > HR_TOLERANCE.error ? 'error' : 'warn', week: n, day,
            message: `"${w.target_hr}" — ${t.bpm[0]}-${t.bpm[1]} bpm is outside Z${t.zones[0]}${t.zones.length > 1 ? `-Z${t.zones[t.zones.length - 1]}` : ''} (${lo}-${hi}).` });
        }
      }
    }
  });

  return v;
}

// ---------------------------------------------------------------------------
// Step 7, measured half — do the pieces join up?
// ---------------------------------------------------------------------------

/** Long run jump at a phase join that counts as a seam rather than progression. */
const JOIN_LONG_RUN_JUMP = 0.25;
/** Peak short of the outline's own peak by more than this. */
const PEAK_SHORTFALL = 0.15;

/**
 * Checks that only make sense across phases. Phases are written separately
 * and in parallel, so the joins between them are exactly where a plan can
 * come apart without any single week breaking a rule.
 */
export function checkCoherence(
  weeks: PlanWeek[],
  outline: PlanOutline,
  opts: { hasElevation: boolean },
): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  const byNum = new Map(weeks.map((w) => [w.week_number, w]));
  const recoveryWeeks = new Set(outline.weeks.filter((w) => w.is_recovery).map((w) => w.week));

  // Phase joins: the first week of a phase against the last loading week of
  // the phase before. A long run that leaps at the seam was set by a writer
  // that never saw the previous phase.
  for (let p = 1; p < outline.phases.length; p++) {
    const start = outline.phases[p].start_week;
    let prevNum = start - 1;
    while (prevNum > 0 && recoveryWeeks.has(prevNum)) prevNum--;
    const prev = byNum.get(prevNum), first = byNum.get(start);
    if (!prev || !first) continue;
    const a = longRunOf(prev)?.km, b = longRunOf(first)?.km;
    if (a && b && b > a * (1 + JOIN_LONG_RUN_JUMP)) {
      issues.push({ severity: 'must_fix', weeks: [prevNum, start], source: 'code',
        problem: `Long run jumps from ${fmt(a)} km (week ${prevNum}) to ${fmt(b)} km (week ${start}) at the join into ${outline.phases[p].name}.`,
        fix: `Bring week ${start}'s long run to within ${Math.round(JOIN_LONG_RUN_JUMP * 100)}% of week ${prevNum}'s, or step it up over two weeks.` });
    }
    const qa = runsOf(prev).filter(([, w]) => isQuality(w)).length;
    const qb = runsOf(first).filter(([, w]) => isQuality(w)).length;
    if (qb - qa >= 2) {
      issues.push({ severity: 'note', weeks: [prevNum, start], source: 'code',
        problem: `Quality sessions go from ${qa} to ${qb} at the join into ${outline.phases[p].name}.`,
        fix: 'Introduce the extra intensity over two weeks.' });
    }
  }

  // Recovery weeks should be lighter on EVERYTHING, not just running.
  for (const n of recoveryWeeks) {
    const w = byNum.get(n), prev = byNum.get(n - 1);
    if (!w || !prev) continue;
    const s = (x: PlanWeek) => Object.values(x.workouts ?? {}).filter((wo) => !!strengthOf(wo)).length;
    if (s(w) > s(prev)) {
      issues.push({ severity: 'must_fix', weeks: [n], source: 'code',
        problem: `Recovery week ${n} has more strength sessions (${s(w)}) than week ${n - 1} (${s(prev)}).`,
        fix: `Reduce strength in week ${n} to at most ${s(prev)} session(s), lighter than usual.` });
    }
  }

  // Does the plan arrive where the outline said it would?
  const outlinePeakKm = Math.max(0, ...outline.weeks.map((w) => w.total_km));
  const planPeakKm = Math.max(0, ...weeks.map((w) => w.total_km || 0));
  if (outlinePeakKm > 0 && planPeakKm < outlinePeakKm * (1 - PEAK_SHORTFALL)) {
    const peakWeeks = outline.weeks.filter((w) => w.total_km >= outlinePeakKm * 0.95).map((w) => w.week);
    issues.push({ severity: 'must_fix', weeks: peakWeeks, source: 'code',
      problem: `Peak volume is ${fmt(planPeakKm)} km; the outline builds to ${fmt(outlinePeakKm)} km.`,
      fix: `Bring weeks ${peakWeeks.join(', ')} up to their outline volume.` });
  }
  if (opts.hasElevation) {
    const ov = Math.max(0, ...outline.weeks.map((w) => w.total_elevation_gain_m ?? 0));
    const pv = Math.max(0, ...weeks.map((w) => w.total_elevation_gain_m ?? 0));
    if (ov > 0 && pv < ov * (1 - PEAK_SHORTFALL)) {
      const peakWeeks = outline.weeks.filter((w) => (w.total_elevation_gain_m ?? 0) >= ov * 0.95).map((w) => w.week);
      issues.push({ severity: 'must_fix', weeks: peakWeeks, source: 'code',
        problem: `Peak climbing is ${Math.round(pv)} m; the outline builds to ${Math.round(ov)} m.`,
        fix: `Bring weeks ${peakWeeks.join(', ')} up to their outline climbing.` });
    }
  }

  return issues;
}

/** Counts for comparing two plans on the same rules. */
export function scoreViolations(v: Violation[]): { errors: number; warnings: number; byRule: Record<string, number> } {
  const byRule: Record<string, number> = {};
  for (const x of v) byRule[x.rule] = (byRule[x.rule] ?? 0) + 1;
  return { errors: v.filter((x) => x.severity === 'error').length, warnings: v.filter((x) => x.severity === 'warn').length, byRule };
}
