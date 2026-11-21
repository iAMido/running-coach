/**
 * A plan's strength session -> its own intervals.icu workout, so it reaches
 * the watch as steps the athlete can follow: one block per exercise, one step
 * per set with the reps (or hold) in the step text, and a rest countdown.
 *
 * ## Why a separate event (2026-11-21)
 *
 * Until now the session rode on the run's event as one long note line after
 * the run steps. Garmin shows the run steps; the note stays on the calendar,
 * so the athlete had to open the app to see the exercises. A `WeightTraining`
 * event with its own steps puts every exercise on the wrist.
 *
 * ## Syntax — probed live 2026-11-21 (all probe events deleted after)
 *
 *   - `type: 'WeightTraining'` is accepted and parsed like any workout.
 *   - Text before the duration is the step text, and numbers survive in it:
 *     "- Squat 3x 10-12 2m" -> text "Squat 3x 10-12", 120 s. So the reps can
 *     be the step's own words.
 *   - There is NO lap-button step and NO reps step: "- Squat lap",
 *     "- Squat press lap", "- Squat 12 reps" each produce nothing. Every set is
 *     therefore a TIMED step, sized generously; lap moves on early.
 *   - Traps, each of which silently changes the step:
 *       "70% 1RM"      -> a 70 %FTP power target, text cut to "Squat"
 *       `30"`          -> a 30 s duration
 *       "· 3s lowering" (a standalone `3s`) -> the step becomes 3 seconds
 *       "2 hr"         -> eaten, text cut
 *     A hyphenated range ("30-40s") and spelled-out units ("3 sec", "5 min",
 *     "20 metres", "70pct") are safe. `strengthCue` rewrites into those forms.
 *   - Plain text lines (a title, notes after the steps) are ignored by the
 *     parser even when they contain "3s" or "10m".
 *
 * Kilogram loads are never invented: `load` is passed through as the plan
 * wrote it, or left out.
 */

import type { PlannedStrength } from '@/lib/db/types';
import { formatStepDuration } from '@/lib/intervals/workout-format';

/** intervals.icu event type for a strength session. */
export const STRENGTH_EVENT_TYPE = 'WeightTraining';

/** Rest between sets when the plan names none. */
export const DEFAULT_REST_SEC = 60;
/** Seconds per rep when sizing a set (a slow strength tempo, generous on purpose). */
export const SEC_PER_REP = 4;
/** Setup / side-switch time added to every set. */
export const SET_SETUP_SEC = 10;

const MAX_CUE_LENGTH = 60;
const MAX_EXERCISES = 12;

type Exercise = PlannedStrength['exercises'][number];

/**
 * Step text the parser keeps whole. Numbers stay — the reps ARE the message —
 * but every form the parser reads as a duration, distance or target is spelled
 * out (see the probe notes above).
 */
export function strengthCue(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/%/g, 'pct')
    .replace(/"/g, '')
    .replace(/(\d)\s*'/g, '$1 min')
    .replace(/(\d)\s*(?:seconds|second|secs|sec|s)\b/gi, '$1 sec')
    .replace(/(\d)\s*(?:minutes|minute|mins|min)\b/gi, '$1 min')
    .replace(/(\d)\s*(?:hours|hour|hrs|hr|h)\b/gi, '$1 hour')
    .replace(/(\d)\s*km\b/gi, '$1 kilometres')
    .replace(/(\d)\s*mi\b/gi, '$1 miles')
    .replace(/(\d)\s*(?:mtr|m)\b/gi, '$1 metres')
    // Target words the parser knows, standing alone.
    .replace(/\b(?:z\d|hr|bpm|rpm|ftp|lthr|pace)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+\s*/, '')
    .slice(0, MAX_CUE_LENGTH)
    .trim();
}

/** "8-10" -> 10, "12" -> 12, 12 -> 12. Null when there is no number. */
function upperNumber(v: string | number | undefined | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (!v) return null;
  const nums = String(v).match(/\d+(?:\.\d+)?/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

/** A timed hold written into `reps` ("30-45s", "30 sec") rather than `seconds`. */
function isTimedReps(reps: Exercise['reps']): boolean {
  return typeof reps === 'string' && /\d\s*(?:s|sec|secs|seconds)\b/i.test(reps);
}

/** What one set asks for, in words: "10-12 reps", "30-45 sec", plus "each side". */
export function setAmount(e: Exercise): string {
  let amount: string;
  if (typeof e.seconds === 'number' && e.seconds > 0) {
    amount = `${e.seconds} sec`;
  } else if (isTimedReps(e.reps)) {
    amount = String(e.reps).replace(/\s*(?:seconds|secs|sec|s)\b/i, ' sec').trim();
  } else if (e.reps !== undefined && e.reps !== null && String(e.reps).trim()) {
    const r = String(e.reps).trim();
    amount = /reps?\b/i.test(r) ? r : `${r} reps`;
  } else {
    amount = '';
  }
  return `${amount}${e.each_side ? ' each side' : ''}`.trim();
}

/**
 * How long one set's step runs on the watch. Generous: a timed step that ends
 * mid-set pushes the athlete into rest, while one that runs long is ended with
 * the lap button.
 */
export function setSeconds(e: Exercise): number {
  const sides = e.each_side ? 2 : 1;
  const hold = typeof e.seconds === 'number' && e.seconds > 0 ? e.seconds : isTimedReps(e.reps) ? upperNumber(e.reps) : null;
  const work = hold ?? (upperNumber(e.reps) ?? 10) * SEC_PER_REP;
  const raw = work * sides + SET_SETUP_SEC;
  return Math.min(300, Math.max(20, Math.ceil(raw / 5) * 5));
}

function restSeconds(e: Exercise): number {
  const r = typeof e.rest_seconds === 'number' && e.rest_seconds > 0 ? e.rest_seconds : DEFAULT_REST_SEC;
  return Math.min(300, Math.max(10, Math.round(r / 5) * 5));
}

function setCount(e: Exercise): number {
  const n = Math.round(Number(e.sets));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : 1;
}

/**
 * "<exercise> <amount>", within the length cap. A long name is shortened
 * rather than the amount — "Squat 10-1" would be worse than a clipped name.
 * Parenthetical detail goes first (the full name stays in the notes), then
 * whole words; a clip never leaves an unclosed "(".
 */
export function setCue(exercise: string, amount: string): string {
  const amt = strengthCue(amount);
  const room = Math.max(10, MAX_CUE_LENGTH - (amt ? amt.length + 1 : 0));
  let name = strengthCue(exercise);
  if (name.length > room) name = name.replace(/\s*\([^)]*\)/g, '').trim();
  if (name.length > room) {
    name = name.slice(0, room + 1).replace(/\s+\S*$/, '').replace(/\s*\([^)]*$/, '').replace(/[\s,;:·/-]+$/, '');
  }
  return `${name}${amt ? ` ${amt}` : ''}`.trim();
}

export interface StrengthTranslation {
  /** Event name on the calendar and the watch. */
  name: string;
  /** Parser-facing steps only. Notes travel separately, as for a run. */
  description: string;
  /** Plain note lines, already safe for the parser. */
  notes: string[];
  minutes: number;
  /** One line for the push preview. */
  summary: string;
  /** The step text the parser should read back, in order (sets × exercises, rests omitted). For tests and the live check. */
  cues: string[];
}

/** "Strength: Foundation A: hips and single-leg" — capped for a watch list. */
export function strengthEventName(st: PlannedStrength): string {
  const name = `Strength: ${st.name.trim()}`;
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}

/**
 * The session as an intervals.icu description:
 *
 *   3x
 *   - Bodyweight squat (3 sec down, 1 sec up) 10-12 reps 1m
 *   - Rest 45s
 *
 *   - Bird dog 8-10 reps each side 1m30s      <- a single set: no repeat
 *   - Rest 30s
 *   ...
 *
 * plus `notes`: name and length, focus, per-exercise load and coaching notes.
 *
 * Null when the session has no usable exercise.
 */
export function strengthToWorkout(st: PlannedStrength | null | undefined): StrengthTranslation | null {
  if (!st?.name || !Array.isArray(st.exercises)) return null;
  const exercises = st.exercises.filter((e) => e && strengthCue(e.exercise)).slice(0, MAX_EXERCISES);
  if (!exercises.length) return null;

  const lines: string[] = [];
  const cues: string[] = [];
  const summary: string[] = [];
  let total = 0;

  exercises.forEach((e, i) => {
    const sets = setCount(e);
    const amount = setAmount(e);
    const cue = setCue(e.exercise, amount);
    const work = setSeconds(e);
    const rest = restSeconds(e);
    const last = i === exercises.length - 1;
    summary.push(`${strengthCue(e.exercise)} ${sets}×${amount || '—'}`);

    if (sets > 1) {
      // The rest inside the block doubles as the walk to the next exercise.
      lines.push(`${sets}x`);
      lines.push(`- ${cue} ${formatStepDuration(work)}`);
      lines.push(`- Rest ${formatStepDuration(rest)}`);
      lines.push('');
      for (let s = 0; s < sets; s++) cues.push(cue);
      total += sets * (work + rest);
    } else {
      lines.push(`- ${cue} ${formatStepDuration(work)}`);
      cues.push(cue);
      total += work;
      if (!last) {
        lines.push(`- Rest ${formatStepDuration(rest)}`);
        total += rest;
      }
      lines.push('');
    }
  });

  // Notes: the parser ignores plain lines, but none may start with "-" or end
  // in "Nx", the two shapes that open a step or a repeat.
  const notes: string[] = [];
  notes.push(`${st.name.trim()}${st.duration_minutes ? ` — about ${st.duration_minutes} min` : ''}. Each set is timed; press lap to move on when you finish early.`);
  if (st.focus?.trim()) notes.push(`Focus: ${st.focus.trim()}`);
  for (const e of exercises) {
    const detail = [e.load?.trim(), e.note?.trim()].filter(Boolean).join(' — ');
    if (detail) notes.push(`${e.exercise.trim()}: ${detail}`);
  }
  const safe = notes.map((n) =>
    n.replace(/\s*\n+\s*/g, ' ').replace(/^\s*-+\s*/, '• ').replace(/(\d+\s*x)\s*$/i, '$1.').trim(),
  );

  return {
    name: strengthEventName(st),
    description: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    notes: safe,
    minutes: Math.round(total / 60),
    summary: summary.join(' · '),
    cues,
  };
}
