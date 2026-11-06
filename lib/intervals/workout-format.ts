/**
 * Render a planned workout as an intervals.icu workout description.
 *
 * ## Why percentages of MAX HR
 *
 * intervals.icu's parser accepts only percentages, never absolute bpm — that is
 * deliberate on their side, so workouts stay portable between athletes. Probed
 * live on 2026-08-07 with two pushes four zones apart:
 *
 *   "- 10m 72-83% HR"  -> midpoint 77.5%; landed in their Z2 (146-154 bpm)
 *   "- 10m 95-96% HR"  -> midpoint 95.5%; landed in their Z6 (177-182 bpm)
 *
 * Against max 191 those midpoints are 148 and 182 — matching. Against threshold
 * 173 they would be 134 and 165, which are their Z1 and Z4 — not matching. So
 * `% HR` resolves against **max HR**, and both events were deleted after.
 *
 * That is the good outcome: this app's own bands are %-of-max anchored on the
 * same 191, so the two systems share an anchor and the conversion is direct.
 * The `lactate_threshold_hr` disagreement (app 165, intervals.icu 173) never
 * enters the calculation, which is what previously blocked write-back.
 *
 * The API stores the percentages verbatim (`{"start":81.2,"end":88,
 * "units":"%hr"}`) and resolves them on read, so a pushed workout follows max
 * HR if it ever changes rather than freezing the bpm at push time.
 *
 * ## Rounding
 *
 * Decimals are accepted — verified, `81.2` survived the round trip. One decimal
 * place makes boundaries near-exact; integers cost about a bpm, enough to put
 * the bottom of a Z4 prescription just under the Z4 floor. Rounding is inward
 * regardless (floors up, ceilings down) so a prescription can never resolve
 * outside the zone it names.
 */

import type { PlanStep, Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';
import { parsePlannedZoneBand } from '@/lib/utils/zone-discipline';

export type WorkoutStep =
  | {
      kind: 'steady';
      /** Duration: `seconds` wins when both are given. */
      minutes?: number;
      seconds?: number;
      /** Omitted = no target (a walk-down, a jog recovery). */
      pctLow?: number;
      pctHigh?: number;
      /** Cue shown on the watch. Must come BEFORE the duration (verified). */
      text?: string;
      role?: 'warmup' | 'cooldown';
    }
  | { kind: 'repeat'; times: number; steps: WorkoutStep[] };

/** bpm as a percentage of max HR, rounded INWARD to one decimal place. */
export function bpmToPct(bpm: number, maxHr: number, edge: 'low' | 'high'): number {
  if (!maxHr || maxHr <= 0) throw new Error('maxHr must be positive to compute % HR');
  const raw = (bpm / maxHr) * 100;
  const rounded = edge === 'low' ? Math.ceil(raw * 10) / 10 : Math.floor(raw * 10) / 10;
  return Math.max(0, Math.min(100, rounded));
}

function formatPctRange(pctLow: number, pctHigh: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${fmt(pctLow)}-${fmt(pctHigh)}% HR`;
}

/** 600 -> "10m", 45 -> "45s", 90 -> "90s" (all three verified live). */
export function formatStepDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  return s % 60 === 0 ? `${s / 60}m` : `${s}s`;
}

/**
 * A cue the parser cannot misread: words only. Numbers, zone names and units
 * are stripped — "45s" or "Z3" inside the text would be parsed as part of the
 * step. Capped so it fits a watch screen.
 */
export function cleanCue(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/\bz\s*\d\b/gi, ' ')
    .replace(/[\d%()[\]{}:;+=*\/\|<>~^]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    // Single letters and unit words left behind by the stripped numbers
    // ("15 m/km" -> "m km"): the parser reads units, so none may remain.
    .filter((w) => (w.length > 1 || /^a$/i.test(w)) && !/^(km|mi|min|mins|sec|secs|hr|hrs|bpm|rpm|kmh|kph|pace|ftp|lthr)$/i.test(w))
    .join(' ')
    .trim()
    .slice(0, 40)
    .trim();
}

function stepSeconds(step: Extract<WorkoutStep, { kind: 'steady' }>): number {
  return step.seconds ?? (step.minutes ?? 0) * 60;
}

function stepLine(step: Extract<WorkoutStep, { kind: 'steady' }>): string {
  const cue = cleanCue(step.text);
  const dur = step.seconds === undefined && step.minutes !== undefined && Number.isInteger(step.minutes)
    ? `${step.minutes}m`
    : formatStepDuration(stepSeconds(step));
  const target = step.pctLow !== undefined && step.pctHigh !== undefined ? ` ${formatPctRange(step.pctLow, step.pctHigh)}` : '';
  return `- ${cue ? `${cue} ` : ''}${dur}${target}`;
}

/** Total seconds of a step list, repeats multiplied out. */
export function totalSeconds(steps: WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.kind === 'steady' ? stepSeconds(s) : s.times * totalSeconds(s.steps)), 0);
}

/**
 * Steps -> description text, in the syntax probed live on 2026-11-06 (both
 * test events deleted after):
 *
 *   Warmup                       <- header line: the next step gets warmup:true
 *   - Easy jog 10m 62-75% HR     <- cue text BEFORE the duration (after the
 *                                   target it is silently dropped)
 *
 *   6x                           <- a line ending in "Nx" opens a repeat block
 *   - Hard uphill 45s 80-88% HR
 *   - Walk down 90s              <- no target is a valid step
 *                                <- a blank line closes the block
 *   Cooldown
 *   - 10m 57-70% HR
 *
 * A plain steady step with no cue renders exactly as v1 did ("- 90m
 * 65.5-75.9% HR"), which was verified on 2026-08-07.
 */
export function renderWorkoutDescription(steps: WorkoutStep[]): string {
  const lines: string[] = [];
  const blank = () => { if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push(''); };

  for (const step of steps) {
    if (step.kind === 'steady') {
      if (step.role) {
        blank();
        lines.push(step.role === 'warmup' ? 'Warmup' : 'Cooldown');
        lines.push(stepLine(step));
        lines.push('');
      } else {
        lines.push(stepLine(step));
      }
      continue;
    }

    // Blank line before and after so the repeat block is unambiguously bounded.
    blank();
    lines.push(`${step.times}x`);
    for (const inner of step.steps) {
      if (inner.kind !== 'steady') continue; // nested repeats are not supported
      lines.push(stepLine({ ...inner, role: undefined }));
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * "45 min", "1h 10min", "110 min" -> minutes. Null when unparseable.
 *
 * The minute unit must list the long forms first: a bare `m` followed by a
 * negative-lookahead for word characters fails on "min", because `i` is one.
 */
export function parseDurationMinutes(duration: string | undefined): number | null {
  if (!duration) return null;
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr|h)\b/i.exec(duration);
  const mins = /(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min|m)\b/i.exec(duration);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  if (total > 0) return total;
  const bare = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(duration);
  return bare ? Number(bare[1]) : null;
}

/**
 * The bpm range from a `target_hr` string's parenthetical, e.g. "Z1-Z2
 * (125-145)" -> {125, 145}.
 *
 * NOT anchored at the end of the string: 2 of ~45 real workouts carry trailing
 * text — "Z3-Z4 (155-175) on climbs" and "Z3-Z4 (160-175) climbs" — and a `$`
 * anchor would reject both.
 */
export function parseTargetBpm(targetHr: string | null | undefined): { low: number; high: number } | null {
  if (!targetHr) return null;
  const m = /\(\s*(\d{2,3})\s*[-–—]\s*(\d{2,3})\s*\)/.exec(targetHr);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  // Plausible running heart rates only — guards against a stray pace or
  // distance in parentheses being read as bpm.
  if (low < 60 || high > 220 || low >= high) return null;
  return { low, high };
}

export interface WorkoutTranslation {
  description: string;
  /** The bpm range of the session's main target, for the UI to show. Null when no step has one. */
  bpmLow: number | null;
  bpmHigh: number | null;
  minutes: number;
  /** Where the bpm came from — the plan's own numbers, or the zone label. */
  source: 'target_bpm' | 'zone_band';
  /** True when the workout went out as real steps (warm-up, reps, cool-down). */
  structured: boolean;
  /** One line for the UI: what the watch will show. */
  summary: string;
  /** Non-fatal notes worth showing the athlete, e.g. dropped "+ bursts". */
  notes: string[];
}

/** Work reps shorter than this are run by effort: HR lags 30-60 s behind. */
export const EFFORT_ONLY_BELOW_SEC = 120;

interface ResolvedHr { low: number; high: number; source: 'target_bpm' | 'zone_band'; label?: string }

/** A plan HR string -> bpm: the parenthetical first, else the zone label's band. */
export function resolveHr(hr: string | null | undefined, bands: ZoneBands): ResolvedHr | null {
  const bpm = parseTargetBpm(hr);
  if (bpm) return { ...bpm, source: 'target_bpm' };
  const band = parsePlannedZoneBand(hr);
  if (!band) return null;
  const floorBand = bands[`z${band.floor}` as keyof ZoneBands];
  const ceilingBand = bands[`z${band.ceiling}` as keyof ZoneBands];
  if (!floorBand || !ceilingBand) return null;
  return { low: floorBand.low, high: ceilingBand.high, source: 'zone_band', label: band.label };
}

function stepDurationSec(s: PlanStep): number {
  const sec = typeof s.sec === 'number' && s.sec > 0 ? s.sec : typeof s.min === 'number' && s.min > 0 ? s.min * 60 : 0;
  return Math.min(sec, 4 * 3600);
}

/** Plan steps flattened one level (repeat blocks opened, not multiplied). */
export function flatPlanSteps(steps: PlanStep[] | null | undefined): PlanStep[] {
  return (steps ?? []).flatMap((s) => (s?.kind === 'repeat' ? s.steps ?? [] : s ? [s] : []));
}

/** Total seconds of plan steps, repeats multiplied out. Unusable steps count 0. */
export function planStepsSeconds(steps: PlanStep[] | null | undefined): number {
  return (steps ?? []).reduce((sum, s) => {
    if (!s) return sum;
    if (s.kind === 'repeat') return sum + Math.max(0, Math.round(Number(s.reps)) || 0) * planStepsSeconds(s.steps);
    return sum + stepDurationSec(s);
  }, 0);
}

type Steady = Extract<WorkoutStep, { kind: 'steady' }>;

/**
 * Plan steps -> watch steps. Null when they do not describe a usable session
 * (nothing with a duration), so the caller falls back to one steady step.
 */
export function planStepsToWorkoutSteps(
  planSteps: PlanStep[] | null | undefined,
  bands: ZoneBands,
  maxHr: number,
  notes: string[] = [],
): WorkoutStep[] | null {
  if (!Array.isArray(planSteps) || planSteps.length === 0) return null;
  let effortNote = false;

  const one = (ps: PlanStep): Steady | null => {
    const seconds = stepDurationSec(ps);
    if (!seconds) return null;
    const hr = resolveHr(ps.hr, bands);
    const step: Steady = { kind: 'steady', seconds, text: cleanCue(ps.cue) || undefined };
    if (ps.kind === 'warmup' || ps.kind === 'cooldown') step.role = ps.kind;
    if (ps.kind === 'work' && seconds < EFFORT_ONLY_BELOW_SEC) {
      // A 45 s rep ends before HR reaches its zone: an HR alert would nag him
      // to push harder all the way up. Run it by effort, by the cue.
      step.text = step.text ?? 'Hard effort';
      effortNote = true;
    } else if (hr) {
      step.pctLow = bpmToPct(hr.low, maxHr, 'low');
      step.pctHigh = bpmToPct(hr.high, maxHr, 'high');
    }
    return step;
  };

  const out: WorkoutStep[] = [];
  for (const ps of planSteps) {
    if (!ps || typeof ps !== 'object') continue;
    if (ps.kind === 'repeat') {
      const reps = Math.round(Number(ps.reps));
      const inner = (ps.steps ?? [])
        .filter((x) => x && x.kind !== 'repeat')
        .map(one)
        .filter((x): x is Steady => !!x)
        .map((x) => ({ ...x, role: undefined }));
      if (reps >= 1 && reps <= 50 && inner.length) {
        if (reps === 1) out.push(...inner);
        else out.push({ kind: 'repeat', times: reps, steps: inner });
      }
      continue;
    }
    const s = one(ps);
    if (s) out.push(s);
  }
  if (!out.length || totalSeconds(out) < 60) return null;
  if (effortNote) notes.push(`Short reps (under ${EFFORT_ONLY_BELOW_SEC / 60} min) carry no HR alert — run them by effort; HR lags behind.`);
  return out;
}

/** "10m warm-up · 6× (45s hard uphill / 90s walk down) · 10m cool-down" */
export function summarizeSteps(steps: WorkoutStep[]): string {
  const dur = (s: Steady) => formatStepDuration(s.seconds ?? (s.minutes ?? 0) * 60);
  const label = (s: Steady) =>
    s.role === 'warmup' ? ' warm-up' : s.role === 'cooldown' ? ' cool-down' : s.text ? ` ${s.text.toLowerCase()}` : '';
  return steps.map((s) => {
    if (s.kind === 'repeat') {
      return `${s.times}× (${s.steps.map((x) => (x.kind === 'steady' ? `${dur(x)}${label(x)}` : '')).join(' / ')})`;
    }
    const target = s.pctLow !== undefined && s.pctHigh !== undefined ? ` ${formatPctRange(s.pctLow, s.pctHigh)}` : '';
    return `${dur(s)}${label(s)}${target}`;
  }).join(' · ');
}

/** A note line the workout parser cannot mistake for a step or a repeat header. */
function safeNote(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^\s*-+\s*/, '• ')
    .replace(/(\d+\s*x)\s*$/i, '$1.')
    .trim();
}

function strengthNote(w: Workout): string | null {
  const st = w.strength;
  if (!st?.name) return null;
  const ex = (st.exercises ?? []).slice(0, 10).map((e) => {
    const amount = e.seconds ? `${e.sets}×${e.seconds}s` : `${e.sets}×${e.reps ?? ''}`;
    return `${e.exercise} ${amount}${e.each_side ? ' each side' : ''}${e.load ? ` (${e.load})` : ''}`;
  });
  return `Strength after the run — ${st.name}${st.duration_minutes ? `, ~${st.duration_minutes} min` : ''}${ex.length ? `: ${ex.join('; ')}` : ''}.`;
}

/**
 * A planned workout -> a pushable description.
 *
 * ## Uses the parenthetical bpm, NOT the zone label — deliberately the
 * ## opposite of what `zone-discipline.ts` does
 *
 * The two features want different fields for different reasons, and someone
 * will eventually "fix" one to match the other. They should not.
 *
 * - `zone-discipline.ts` compares intent against `pct_z1..z6`, which are
 *   computed from the *label's* definition. It must use the label, and must
 *   ignore the bpm — those numbers predate the max-HR-191 rescale.
 * - Here the output is a target on a watch. The label's band is useless for
 *   that: `Z1-Z2` is 0-143 bpm, an alert that would never fire. The
 *   parenthetical is the author's actual intent, and it varies within a single
 *   label — `Z2-Z3` appears as (145-165), (150-165), (145-160) and (145-162) —
 *   which is someone expressing a specific target, not picking a zone.
 *
 * Falls back to the label's band only when there is no parenthetical.
 *
 * ## Steps (2026-11-06)
 *
 * When the plan carries `steps`, the session goes out as a structured workout
 * — warm-up, repeat blocks of work and recovery, cool-down, each with its cue
 * (see `renderWorkoutDescription` for the probed syntax). Without them it is
 * ONE steady step, as in v1: free-text structure ("6x45s uphill, walk down")
 * is never parsed here, because a mis-parsed interval session on the wrist is
 * worse than a correct steady one.
 *
 * The plan's description and the strength session travel as notes.
 *
 * Returns null only when the workout is not a session at all (rest days carry
 * "—" for every field) or has no usable duration or target.
 */
export function planWorkoutToDescription(
  workout: Workout,
  bands: ZoneBands,
  maxHr: number,
): WorkoutTranslation | null {
  const notes: string[] = [];
  const overall = resolveHr(workout.target_hr, bands);
  const structuredSteps = planStepsToWorkoutSteps(workout.steps, bands, maxHr, notes);

  let steps: WorkoutStep[];
  let minutes: number;
  let bpmLow: number | null = overall?.low ?? null;
  let bpmHigh: number | null = overall?.high ?? null;
  let source: WorkoutTranslation['source'] = overall?.source ?? 'target_bpm';

  if (structuredSteps) {
    steps = structuredSteps;
    minutes = Math.round(totalSeconds(steps) / 60);
    if (bpmLow === null) {
      const first = flatPlanSteps(workout.steps).map((s) => resolveHr(s.hr, bands)).find((x) => !!x);
      if (first) ({ low: bpmLow, high: bpmHigh, source } = first);
    }
    const planned = parseDurationMinutes(workout.duration);
    if (planned && Math.abs(minutes - planned) > Math.max(5, planned * 0.15)) {
      notes.push(`Steps add up to ${minutes} min; the plan says ${workout.duration}.`);
    }
  } else {
    const planned = parseDurationMinutes(workout.duration);
    if (!planned || !overall) return null;
    minutes = planned;
    if (overall.source === 'zone_band') {
      notes.push(`No bpm range in the plan — used the ${overall.label} band (${overall.low}-${overall.high} bpm).`);
    }
    steps = [{
      kind: 'steady',
      minutes,
      pctLow: bpmToPct(overall.low, maxHr, 'low'),
      pctHigh: bpmToPct(overall.high, maxHr, 'high'),
    }];
  }

  // Anything after the closing paren is real coaching intent the percentages
  // cannot carry ("on climbs", "+ bursts"). Surface it rather than drop it.
  // Strip up to the closing paren only when there IS one — otherwise the
  // replace is a no-op and the whole string reads as "trailing" text.
  const trailing = overall?.source === 'target_bpm'
    ? (workout.target_hr ?? '').replace(/^.*\)/, '').trim()
    : extraAfterZone(workout.target_hr);
  if (trailing) notes.push(`Plan also says: "${trailing}".`);

  // The coach's own words for the session — the "why" and the feel the steps
  // cannot carry.
  if (workout.description?.trim()) notes.push(`Coach: ${workout.description.trim().slice(0, 400)}`);

  // Elevation travels as a NOTE, never as a workout step.
  //
  // intervals.icu's parser understands duration, HR, pace and power — there is
  // no elevation step, and inventing syntax it does not know risks malforming
  // the whole workout rather than adding a field to it.
  //
  // Absent stays absent: a plan that never prescribed vert must not push
  // "0 m", which would read as "deliberately flat".
  if (typeof workout.elevation_gain_m === 'number') {
    notes.push(`Target climb: ${workout.elevation_gain_m} m.`);
  }

  // The indoor fallback rides along for the same reason — it is most useful at
  // the moment the athlete looks at the workout and the weather has turned.
  if (workout.indoor_alternative?.type) {
    const alt = workout.indoor_alternative;
    notes.push(
      `If indoors: ${alt.type}${alt.equipment ? ` (${alt.equipment})` : ''}` +
        `${alt.duration ? `, ${alt.duration}` : ''}${alt.description ? ` — ${alt.description}` : ''}`,
    );
  }

  const strength = strengthNote(workout);
  if (strength) notes.push(strength);

  return {
    description: renderWorkoutDescription(steps),
    bpmLow, bpmHigh, minutes, source,
    structured: !!structuredSteps,
    summary: summarizeSteps(steps),
    notes: notes.map(safeNote),
  };
}

/** Trailing text when there was no parenthetical at all, e.g. "Z1-Z2 + bursts". */
function extraAfterZone(targetHr: string | null | undefined): string {
  if (!targetHr) return '';
  return targetHr.replace(/^\s*z\s*\d(?:\s*[-–—to]+\s*z?\s*\d)?/i, '').trim();
}
