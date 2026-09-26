/**
 * Expert plan exemplars — how real coaches built real plans, distilled so the
 * model can learn the STRUCTURE rather than copy the sessions.
 *
 * ## Source
 *
 * Ten full plans exported from a coaching platform and supplied by the athlete
 * on 2026-09-26: two Carmel-Kinneret trail races (33K and 55K, both with
 * integrated strength and per-session climb targets), three Norwegian-method
 * plans, a half-marathon PB plan, a return-to-running plan, two strength-only
 * blocks, and a half-Ironman.
 *
 * ## Why distil instead of embedding the raw JSON
 *
 * The raw files are 140 KB to 4 MB, and almost none of those bytes are signal.
 * A single strength session carries its exercises three times over — once as
 * `strength_exercises`, once as a 2,156-character `canonical_steps` tree, and
 * again in prose. Fed raw, a model spends its context on serialisation format.
 * The signal is: phase shape, loading rhythm, volume and climb progression,
 * the coach's own stated reasoning for each phase, and how strength is placed
 * and progressed. That fits in ~3 KB per plan.
 *
 * ## FOUR strength encodings — read all of them
 *
 * The exports store a strength session's exercises in one of four places, and
 * which one varies by plan:
 *
 *   1. `strength_exercises`     structured array            (Carmel, Norwegian)
 *   2. `canonical_steps`        repeat/set tree             (Half-Marathon PB)
 *   3. `library_workout.steps`  the same tree, nested       (both strength-only
 *                               inside a library object      blocks, half-Ironman)
 *   4. `notes`                  prose only                  (fallback)
 *
 * An extractor reading only the first three would have turned BOTH strength-
 * only plans into empty shells: their sessions have no name, no exercises, no
 * notes and no steps at the top level — everything lives in `library_workout`.
 * That is not hypothetical; it is what the first survey of these files showed.
 * `plan-exemplars.test.ts` pins each encoding.
 *
 * ## Days are RELATIVE
 *
 * Sessions are assigned to `day1`..`day7`, not weekdays. They describe the
 * rhythm of a week, and must be mapped onto the athlete's own training days —
 * never copied onto the calendar as if day2 meant Monday.
 */

// ------------------------------------------------------------------ types

export interface ExemplarStrengthExercise {
  exercise: string;
  sets: number | null;
  /** Reps, or a range like "8-10". Null for timed holds. */
  reps: string | null;
  /** Timed holds (planks) instead of reps. */
  seconds: number | null;
  restSeconds: number | null;
  /** "75% 1RM" — present only when the plan prescribed load. */
  load: string | null;
  unilateral: boolean;
  note: string | null;
}

export interface ExemplarSession {
  day: string;
  sport: string;
  type: string;
  name: string | null;
  minutes: number | null;
  km: number | null;
  zones: string[];
  elevationM: number | null;
  notes: string | null;
  /** Empty for non-strength sessions. */
  strength: ExemplarStrengthExercise[];
  /** Which encoding the strength came from — kept for tests and debugging. */
  strengthSource: 'strength_exercises' | 'canonical_steps' | 'library_workout' | 'notes' | null;
}

export interface ExemplarWeek {
  week: number;
  phase: string;
  km: number | null;
  minutes: number | null;
  recovery: boolean;
  elevationM: number;
  note: string | null;
  sessions: ExemplarSession[];
}

export type ExemplarKind = 'full_plan' | 'strength_block' | 'return_to_run' | 'multisport';

export interface PlanExemplar {
  sourceKey: string;
  name: string;
  description: string;
  kind: ExemplarKind;
  weeks: number;
  sports: Record<string, number>;
  tags: string[];
  goal: { distanceKm: number | null; elevationGainM: number | null; elevationLossM: number | null };
  phases: { name: string; fromWeek: number; toWeek: number }[];
  kmByWeek: (number | null)[];
  elevationByWeek: number[];
  recoveryWeeks: number[];
  /** e.g. "3:1" when recovery weeks fall on a regular cadence. */
  loadingPattern: string | null;
  runsPerWeek: number;
  strengthSessionsPerWeekByPhase: Record<string, number>;
  /**
   * Every DISTINCT coaching note, in order, with the weeks it covers.
   *
   * Not one per phase: the exports template notes per SUB-block, and the
   * progression lives in the changes. Carmel 33K's 16-week build phase carries
   * two different messages (weeks 9-15 "the continuous climb and the downhill
   * repeats enter"; weeks 17-23 "race-specific ... hiking the climbs, running
   * the descents, fuelling every hour"), and its recovery weeks deepen from
   * "about 80 %" to "about 70 %". One note per phase would keep neither.
   */
  coachingNotes: { phase: string; weeks: string; recovery: boolean; note: string }[];
  representativeWeeks: ExemplarWeek[];
}

// ------------------------------------------------------------- raw shapes

/* The export format is large and loosely typed; these are the fields read. */
interface RawSet {
  type?: string;
  exercise_name?: string | null;
  exercise_display_name?: string | null;
  target_reps?: number | null;
  reps?: number | null;
  duration?: { type?: string; value?: number } | null;
  rest_seconds?: number | null;
  target_percent_1rm?: number | null;
  unilateral?: boolean | null;
  coaching_note?: string | null;
  steps?: RawSet[];
  repeat_count?: number | null;
  name?: string | null;
}

interface RawSession {
  sport?: string;
  type?: string;
  name?: string | null;
  notes?: string | null;
  assigned_day?: string | null;
  duration_minutes_target?: number | null;
  distance_km_target?: number | null;
  zone_targets?: string[] | null;
  elevation_gain_m_target?: number | null;
  strength_exercises?: {
    exercise?: string; sets?: number | null; reps?: number | null; reps_high?: number | null;
    duration_seconds?: number | null; rest_seconds?: number | null; unilateral?: boolean | null;
  }[] | null;
  canonical_steps?: RawSet[] | null;
  library_workout?: { name?: string | null; description?: string | null; notes?: string | null; steps?: RawSet[] | null } | null;
}

interface RawWeek {
  week_index?: number;
  phase?: string;
  planned_volume_km?: number | null;
  planned_volume_minutes?: number | null;
  is_recovery_week?: boolean;
  coaching_note?: string | null;
  sessions?: RawSession[];
}

export interface RawPlan {
  name?: string;
  description?: string | null;
  plan_length_weeks?: number;
  goal?: { description?: string | null; target_distance_km?: number | null } | null;
  weeks?: RawWeek[];
}

// ------------------------------------------------------------ strength

const STRENGTH_SPORTS = new Set(['strength']);

function repsLabel(low: number | null | undefined, high: number | null | undefined): string | null {
  if (typeof low !== 'number') return null;
  return typeof high === 'number' && high !== low ? `${low}-${high}` : String(low);
}

/** Walk a repeat/set tree (encodings 2 and 3), carrying the repeat count as sets. */
function exercisesFromSteps(steps: RawSet[] | null | undefined): ExemplarStrengthExercise[] {
  const out: ExemplarStrengthExercise[] = [];
  const visit = (node: RawSet, sets: number | null) => {
    if (node.type === 'set') {
      const name = node.exercise_display_name || node.exercise_name;
      if (!name) return;
      const seconds = node.duration?.type === 'time' && typeof node.duration.value === 'number' ? node.duration.value : null;
      out.push({
        exercise: humanise(name),
        sets,
        reps: repsLabel(node.target_reps ?? node.reps, null),
        seconds,
        restSeconds: node.rest_seconds ?? null,
        load: typeof node.target_percent_1rm === 'number' ? `${Math.round(node.target_percent_1rm * 100)}% 1RM` : null,
        unilateral: !!node.unilateral,
        note: node.coaching_note ?? null,
      });
      return;
    }
    const count = node.type === 'repeat' && typeof node.repeat_count === 'number' ? node.repeat_count : sets;
    for (const child of node.steps ?? []) visit(child, count);
  };
  for (const s of steps ?? []) visit(s, null);
  return out;
}

/** TRAP_BAR_DEADLIFT -> Trap Bar Deadlift. Display names pass through untouched. */
function humanise(name: string): string {
  if (!/^[A-Z0-9_]+$/.test(name)) return name;
  return name.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Exercises for one session, from whichever of the four encodings holds them.
 * Order is precedence: the structured array is the cleanest, the nested
 * library tree is the most easily missed.
 */
export function extractStrength(s: RawSession): Pick<ExemplarSession, 'strength' | 'strengthSource'> {
  if (s.strength_exercises?.length) {
    return {
      strengthSource: 'strength_exercises',
      strength: s.strength_exercises
        .filter((e) => !!e.exercise)
        .map((e) => ({
          exercise: e.exercise as string,
          sets: e.sets ?? null,
          reps: repsLabel(e.reps, e.reps_high),
          seconds: e.duration_seconds ?? null,
          restSeconds: e.rest_seconds ?? null,
          load: null,
          unilateral: !!e.unilateral,
          note: null,
        })),
    };
  }
  const fromCanonical = exercisesFromSteps(s.canonical_steps);
  if (fromCanonical.length) return { strength: fromCanonical, strengthSource: 'canonical_steps' };

  const fromLibrary = exercisesFromSteps(s.library_workout?.steps);
  if (fromLibrary.length) return { strength: fromLibrary, strengthSource: 'library_workout' };

  if (STRENGTH_SPORTS.has(s.sport ?? '') && (s.notes || s.library_workout?.description)) {
    return { strength: [], strengthSource: 'notes' };
  }
  return { strength: [], strengthSource: null };
}

// ------------------------------------------------------------- distill

function toSession(s: RawSession): ExemplarSession {
  const { strength, strengthSource } = extractStrength(s);
  return {
    day: s.assigned_day ?? '?',
    sport: s.sport ?? 'unknown',
    type: s.type ?? 'unknown',
    // Strength-only exports leave the top-level name null and put it on the
    // library object — the same trap as their exercises.
    name: s.name ?? s.library_workout?.name ?? null,
    minutes: s.duration_minutes_target ?? null,
    km: s.distance_km_target ?? null,
    zones: s.zone_targets ?? [],
    elevationM: typeof s.elevation_gain_m_target === 'number' ? s.elevation_gain_m_target : null,
    notes: s.notes || s.library_workout?.notes || s.library_workout?.description || null,
    strength,
    strengthSource,
  };
}

function toWeek(w: RawWeek, i: number): ExemplarWeek {
  const sessions = (w.sessions ?? []).map(toSession);
  return {
    week: w.week_index ?? i + 1,
    phase: w.phase ?? 'unknown',
    km: typeof w.planned_volume_km === 'number' ? Math.round(w.planned_volume_km * 10) / 10 : null,
    minutes: w.planned_volume_minutes ?? null,
    recovery: !!w.is_recovery_week,
    elevationM: sessions.reduce((sum, s) => sum + (s.elevationM ?? 0), 0),
    note: w.coaching_note ?? null,
    sessions,
  };
}

/**
 * Parse the race profile out of the plan's own description, e.g.
 * "31 weeks to the Carmel-Kinneret 33 km on 2 April 2027 (+447 / -847 m)".
 */
export function parseGoal(text: string, explicitKm?: number | null) {
  const elev = text.match(/\+\s*([\d,]+)\s*\/\s*-\s*([\d,]+)\s*m/);
  const km = text.match(/(\d+(?:\.\d+)?)\s*(?:km|k)\b/i);
  const named =
    /half[- ]?ironman|70\.3/i.test(text) ? 113 :
    /half[- ]?marathon/i.test(text) ? 21.1 :
    /\bmarathon\b/i.test(text) ? 42.2 : null;
  return {
    // A named race beats the first number found: "Half-Ironman ... 1.9 km swim,
    // 90 km bike, 21.1 km run" is a 113 km event, not a 1.9 km one, and the
    // regex alone read it as the swim.
    distanceKm: explicitKm ?? named ?? (km ? Number(km[1]) : null),
    elevationGainM: elev ? Number(elev[1].replace(/,/g, '')) : null,
    elevationLossM: elev ? Number(elev[2].replace(/,/g, '')) : null,
  };
}

/**
 * Detect a regular recovery cadence. 7 recovery weeks falling every 4th week
 * reads as "3:1". Returns null rather than guessing when the spacing is
 * irregular — an invented pattern would be taught to the model as fact.
 */
export function detectLoadingPattern(recoveryWeeks: number[]): string | null {
  if (recoveryWeeks.length < 2) return null;
  const gaps = recoveryWeeks.slice(1).map((w, i) => w - recoveryWeeks[i]);
  const first = gaps[0];
  if (!gaps.every((g) => g === first) || first < 2) return null;
  return `${first - 1}:1`;
}

function kindOf(name: string, sports: Record<string, number>): ExemplarKind {
  const keys = Object.keys(sports);
  if (keys.length > 0 && keys.every((k) => k === 'strength')) return 'strength_block';
  if ((sports.swimming ?? 0) > 0 && (sports.cycling ?? 0) > 0) return 'multisport';
  if (/comeback|return/i.test(name)) return 'return_to_run';
  return 'full_plan';
}

function tagsOf(p: PlanExemplar): string[] {
  const t = new Set<string>();
  const text = `${p.name} ${p.description}`.toLowerCase();
  if (p.goal.elevationGainM || /trail|ultra|mountain|kinneret/.test(text)) t.add('trail');
  if (/ultra|55\s*k/.test(text)) t.add('ultra');
  if (/norwegian|threshold/.test(text)) t.add('threshold');
  if (/half[- ]?marathon/.test(text)) t.add('half-marathon');
  else if (/\bmarathon\b/.test(text)) t.add('marathon');
  if (/master/.test(text)) t.add('masters');
  if (Object.values(p.strengthSessionsPerWeekByPhase).some((n) => n > 0)) t.add('strength');
  if (p.kind !== 'full_plan') t.add(p.kind.replace(/_/g, '-'));
  return [...t];
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
}

/** [9,10,11,13,14,15] -> "9-11, 13-15". */
export function compressWeeks(ws: number[]): string {
  if (!ws.length) return '';
  const sorted = [...ws].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const w of sorted.slice(1)) {
    if (w === prev + 1) { prev = w; continue; }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = w;
    prev = w;
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(', ');
}

/**
 * Each distinct note once, in first-appearance order, with every week it
 * appears in. Identical templated notes collapse; a changed note is kept.
 */
export function distinctNotes(weeks: ExemplarWeek[]): PlanExemplar['coachingNotes'] {
  const byNote = new Map<string, { phase: string; weeks: number[]; recovery: boolean }>();
  for (const w of weeks) {
    const note = w.note?.replace(/\s+/g, ' ').trim();
    if (!note) continue;
    const entry = byNote.get(note);
    if (entry) entry.weeks.push(w.week);
    else byNote.set(note, { phase: w.phase, weeks: [w.week], recovery: w.recovery });
  }
  return [...byNote.entries()].map(([note, e]) => ({
    phase: e.phase,
    weeks: compressWeeks(e.weeks),
    recovery: e.recovery,
    note,
  }));
}

/** The middle week of each phase: past the ramp-in, before the transition. */
function representative(weeks: ExemplarWeek[], phases: PlanExemplar['phases']): ExemplarWeek[] {
  return phases.map((ph) => {
    const pool = weeks.filter((w) => w.week >= ph.fromWeek && w.week <= ph.toWeek && !w.recovery);
    const src = pool.length ? pool : weeks.filter((w) => w.week >= ph.fromWeek && w.week <= ph.toWeek);
    return src[Math.floor((src.length - 1) / 2)];
  }).filter(Boolean);
}

export function distillPlan(raw: RawPlan, sourceKey: string): PlanExemplar {
  const weeks = (raw.weeks ?? []).map(toWeek);

  const phases: PlanExemplar['phases'] = [];
  for (const w of weeks) {
    const last = phases[phases.length - 1];
    if (last && last.name === w.phase) last.toWeek = w.week;
    else phases.push({ name: w.phase, fromWeek: w.week, toWeek: w.week });
  }

  const sports: Record<string, number> = {};
  for (const w of weeks) for (const s of w.sessions) sports[s.sport] = (sports[s.sport] ?? 0) + 1;

  const strengthSessionsPerWeekByPhase: Record<string, number> = {};
  for (const ph of phases) {
    const inPhase = weeks.filter((w) => w.week >= ph.fromWeek && w.week <= ph.toWeek);
    const count = inPhase.reduce((n, w) => n + w.sessions.filter((s) => s.sport === 'strength').length, 0);
    strengthSessionsPerWeekByPhase[ph.name] = Math.round((count / Math.max(1, inPhase.length)) * 10) / 10;
  }

  const coachingNotes = distinctNotes(weeks);

  const recoveryWeeks = weeks.filter((w) => w.recovery).map((w) => w.week);
  // Taper weeks are flagged as recovery in these exports, but a taper is not a
  // loading cycle — including them turns a clean 3:1 into "irregular".
  const taperWeeks = new Set(
    phases.filter((p) => /taper|race/i.test(p.name)).flatMap((p) => range(p.fromWeek, p.toWeek)),
  );
  const cycleRecovery = recoveryWeeks.filter((w) => !taperWeeks.has(w));
  const runs = weeks.reduce((n, w) => n + w.sessions.filter((s) => s.sport === 'running').length, 0);
  const description = raw.goal?.description || raw.description || '';
  const name = raw.name ?? sourceKey;

  const ex: PlanExemplar = {
    sourceKey,
    name,
    description,
    kind: kindOf(name, sports),
    weeks: raw.plan_length_weeks ?? weeks.length,
    sports,
    tags: [],
    goal: parseGoal(`${name} ${description}`, raw.goal?.target_distance_km),
    phases,
    kmByWeek: weeks.map((w) => w.km),
    elevationByWeek: weeks.map((w) => w.elevationM),
    recoveryWeeks,
    loadingPattern: detectLoadingPattern(cycleRecovery),
    runsPerWeek: Math.round((runs / Math.max(1, weeks.length)) * 10) / 10,
    strengthSessionsPerWeekByPhase,
    coachingNotes,
    representativeWeeks: representative(weeks, phases),
  };
  ex.tags = tagsOf(ex);
  return ex;
}

// ------------------------------------------------------------- render

function fmtExercise(e: ExemplarStrengthExercise): string {
  const dose = e.seconds ? `${e.sets ?? '?'}×${e.seconds}s` : `${e.sets ?? '?'}×${e.reps ?? '?'}`;
  return [e.exercise + (e.unilateral ? ' (each side)' : ''), dose, e.load, e.restSeconds ? `rest ${e.restSeconds}s` : null]
    .filter(Boolean).join(' ');
}

function fmtSession(s: ExemplarSession): string {
  const bits = [s.day, s.sport === 'strength' ? 'STRENGTH' : s.type];
  if (s.minutes) bits.push(`${s.minutes}min`);
  if (s.km) bits.push(`${s.km}km`);
  if (s.zones.length) bits.push(s.zones.join('/'));
  if (s.elevationM) bits.push(`+${s.elevationM}m`);
  let line = `  - ${bits.join(' · ')}${s.name ? ` — ${s.name}` : ''}`;
  if (s.strength.length) line += `\n      ${s.strength.map(fmtExercise).join(' | ')}`;
  // 150 chars keeps the instruction and drops the elaboration. Longer notes
  // pushed the peak and taper weeks off the end of the budget, and how the
  // week changes across phases is the lesson.
  if (s.notes) line += `\n      "${s.notes.replace(/\s+/g, ' ').slice(0, 150)}"`;
  return line;
}

/**
 * Compact text for a prompt. Budgeted: two of these must sit comfortably
 * beside the rest of the plan-generation context.
 */
export function renderExemplar(ex: PlanExemplar, maxChars = 6500): string {
  const profile = [
    ex.goal.distanceKm ? `${ex.goal.distanceKm} km` : null,
    ex.goal.elevationGainM ? `+${ex.goal.elevationGainM}/-${ex.goal.elevationLossM ?? '?'} m` : null,
  ].filter(Boolean).join(', ');

  const lines: string[] = [
    `### Reference plan: ${ex.name} — ${ex.weeks} weeks${profile ? ` (${profile})` : ''}`,
    `Tags: ${ex.tags.join(', ') || 'none'}`,
  ];
  if (ex.description) lines.push(`Intent: ${ex.description.replace(/\s+/g, ' ').slice(0, 320)}`);
  lines.push(`Phases: ${ex.phases.map((p) => `${p.name} ${p.fromWeek}-${p.toWeek}`).join(' → ')}`);

  const km = ex.kmByWeek.filter((k): k is number => typeof k === 'number' && k > 0);
  if (km.length) {
    lines.push(
      `Volume: ${km[0]} → peak ${Math.max(...km)} km/week` +
        (ex.loadingPattern ? `, ${ex.loadingPattern} loading` : '') +
        // Listed even when irregular: "3:1, then 1:1 in the peak" is a real
        // design choice, and forcing it into one ratio would misstate it.
        (ex.recoveryWeeks.length ? ` (recovery/down weeks: ${ex.recoveryWeeks.join(', ')})` : '') + '.',
    );
    lines.push(`  km by week: ${ex.kmByWeek.map((k) => (k === null ? '-' : Math.round(k))).join(' ')}`);
  }
  if (ex.elevationByWeek.some((m) => m > 0)) {
    lines.push(`  climb by week (m): ${ex.elevationByWeek.map((m) => Math.round(m)).join(' ')}`);
  }
  lines.push(`Runs per week ≈ ${ex.runsPerWeek}.`);

  const strength = Object.entries(ex.strengthSessionsPerWeekByPhase).filter(([, n]) => n > 0);
  if (strength.length) {
    lines.push(`Strength sessions per week by phase: ${strength.map(([p, n]) => `${p} ${n}`).join(', ')}.`);
  }

  if (ex.coachingNotes.length) {
    lines.push("Coach's reasoning, in order (weeks each note covers):");
    for (const n of ex.coachingNotes) {
      lines.push(`  - ${n.recovery ? 'recovery ' : ''}${n.phase}, wk ${n.weeks}: "${n.note.slice(0, 260)}"`);
    }
  }

  lines.push('Representative week per phase (days are RELATIVE — day1..day7, not weekdays):');
  const body: string[] = [];
  for (const w of ex.representativeWeeks) {
    body.push(`  ${w.phase}, week ${w.week}${w.km ? ` — ${w.km} km` : ''}${w.elevationM ? `, +${w.elevationM} m` : ''}:`);
    // A repeated session prints once. Carmel repeats the same strength session
    // twice a week; printed in full it consumed the budget and truncated every
    // later phase — and seeing how the week CHANGES across phases is the point.
    const seen = new Map<string, string>();
    for (const s of w.sessions) {
      const sig = `${s.sport}|${s.name}|${s.strength.map(fmtExercise).join(',')}|${s.km}|${s.minutes}`;
      const first = seen.get(sig);
      // Name WHICH session repeats: a day can hold a run and a strength session.
      if (first) body.push(`  - ${s.day} · ${s.sport === 'strength' ? 'STRENGTH' : s.type} — same as ${first}`);
      else { seen.set(sig, s.day); body.push(fmtSession(s)); }
    }
  }

  // Trim the week detail rather than the structure: phases, loading and the
  // coach's reasoning are the lesson; individual sessions are illustration.
  let text = lines.join('\n');
  for (const line of body) {
    if (text.length + line.length + 1 > maxChars) { text += '\n  …'; break; }
    text += '\n' + line;
  }
  return text;
}

// ------------------------------------------------------------- select

export interface ExemplarRequest {
  planType?: string | null;
  raceDistanceKm?: number | null;
  raceElevationGainM?: number | null;
  goalText?: string | null;
  /** From the athlete profile. Masters strength programming applies at 40+. */
  age?: number | null;
}

/** Minimal stored shape the selector needs, so it can run on DB rows. */
export type SelectableExemplar = Pick<PlanExemplar, 'sourceKey' | 'name' | 'kind' | 'tags' | 'weeks' | 'goal'>;

/**
 * Score an exemplar's relevance to a request. Deterministic, so the choice of
 * reference plans is reproducible and testable rather than a model's guess.
 *
 * Terrain dominates distance on purpose: a 33 km trail plan with climbing is a
 * better model for a 21 km / 1300 m mountain race than a flat half-marathon
 * plan of the right distance. That is the lesson this whole build is based on.
 */
export function scoreExemplar(ex: SelectableExemplar, req: ExemplarRequest): number {
  if (ex.kind === 'strength_block') return -Infinity; // selected separately
  const text = `${req.planType ?? ''} ${req.goalText ?? ''}`.toLowerCase();
  let score = 0;

  const gradient = req.raceElevationGainM && req.raceDistanceKm ? req.raceElevationGainM / req.raceDistanceKm : 0;
  const mountain = gradient >= 20 || /trail|mountain|ultra/.test(text);
  if (mountain) score += ex.tags.includes('trail') ? 10 : -4;
  else score += ex.tags.includes('trail') ? -2 : 2;

  if (ex.kind === 'multisport') score += /triathlon|ironman|70\.3/.test(text) ? 10 : -12;
  if (ex.kind === 'return_to_run') score += /injur|comeback|return|rehab/.test(text) ? 10 : -6;

  if (req.raceDistanceKm && ex.goal.distanceKm) {
    // Log-ratio: 21 vs 33 is closer than 21 vs 55, and symmetric either way.
    score -= Math.abs(Math.log(ex.goal.distanceKm / req.raceDistanceKm)) * 4;
  }
  if (/half/.test(text) && ex.tags.includes('half-marathon')) score += 3;
  if (/marathon/.test(text) && !/half/.test(text) && ex.tags.includes('marathon')) score += 3;
  if (/threshold|norwegian/.test(text) && ex.tags.includes('threshold')) score += 3;
  if (ex.tags.includes('strength')) score += 1;
  return score;
}

export function selectExemplars<T extends SelectableExemplar>(all: T[], req: ExemplarRequest, n = 2): T[] {
  return all
    .map((ex) => ({ ex, s: scoreExemplar(ex, req) }))
    .filter(({ s }) => Number.isFinite(s))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ ex }) => ex);
}

/**
 * One strength-only block to teach exercise selection and loading. Masters
 * programming (joint-care, a gentler deload) from 40; otherwise the runner
 * block. Returns null when neither is loaded rather than substituting.
 */
export function selectStrengthReference<T extends SelectableExemplar>(all: T[], age?: number | null): T | null {
  const blocks = all.filter((e) => e.kind === 'strength_block');
  if (!blocks.length) return null;
  const masters = blocks.find((b) => b.tags.includes('masters'));
  const runner = blocks.find((b) => !b.tags.includes('masters'));
  return (typeof age === 'number' && age >= 40 ? masters ?? runner : runner ?? masters) ?? null;
}
