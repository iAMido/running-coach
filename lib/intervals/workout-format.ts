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

import type { Workout } from '@/lib/db/types';
import type { ZoneBands } from '@/lib/utils/zones';
import { parsePlannedZoneBand } from '@/lib/utils/zone-discipline';

export type WorkoutStep =
  | { kind: 'steady'; minutes: number; pctLow: number; pctHigh: number }
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

/**
 * Steps -> description text.
 *
 * Single steady steps are VERIFIED against the live parser (three pushes on
 * 2026-08-07, all deleted after). The repeat syntax — a bare `5x` on its own
 * line opening a block that a blank line closes — is from the documented spec
 * and is NOT yet verified live, because v1 never emits it. Probe it before the
 * first mapper that does.
 */
export function renderWorkoutDescription(steps: WorkoutStep[]): string {
  const lines: string[] = [];

  for (const step of steps) {
    if (step.kind === 'steady') {
      lines.push(`- ${Math.round(step.minutes)}m ${formatPctRange(step.pctLow, step.pctHigh)}`);
      continue;
    }

    // Blank line before and after so the repeat block is unambiguously bounded.
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${step.times}x`);
    for (const inner of step.steps) {
      if (inner.kind !== 'steady') continue; // nested repeats are not supported
      lines.push(`- ${Math.round(inner.minutes)}m ${formatPctRange(inner.pctLow, inner.pctHigh)}`);
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
  /** The bpm range the percentages were derived from, for the UI to show. */
  bpmLow: number;
  bpmHigh: number;
  minutes: number;
  /** Where the bpm came from — the plan's own numbers, or the zone label. */
  source: 'target_bpm' | 'zone_band';
  /** Non-fatal notes worth showing the athlete, e.g. dropped "+ bursts". */
  notes: string[];
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
 * The bpm has also aged better than the label: `125-145` sits almost exactly on
 * the current Z2 (124-143), closer than it fitted the bands it was written under.
 *
 * Falls back to the label's band only when there is no parenthetical, which
 * happens once in ~45 workouts ("Z1-Z2 + bursts") — a real session that should
 * still reach the watch.
 *
 * v1 emits ONE steady block. The plan's `description` carries interval
 * structure as free text ("Main: 4x(6min tempo / 3min easy)") and a mis-parsed
 * interval session on the wrist is worse than a correct steady one.
 *
 * Returns null only when the workout is not a session at all (rest days carry
 * "—" for every field) or has no usable duration.
 */
export function planWorkoutToDescription(
  workout: Workout,
  bands: ZoneBands,
  maxHr: number,
): WorkoutTranslation | null {
  const minutes = parseDurationMinutes(workout.duration);
  if (!minutes) return null;

  const notes: string[] = [];
  let bpmLow: number;
  let bpmHigh: number;
  let source: WorkoutTranslation['source'];

  const targetBpm = parseTargetBpm(workout.target_hr);
  if (targetBpm) {
    ({ low: bpmLow, high: bpmHigh } = targetBpm);
    source = 'target_bpm';
  } else {
    const band = parsePlannedZoneBand(workout.target_hr);
    if (!band) return null;
    const floorBand = bands[`z${band.floor}` as keyof ZoneBands];
    const ceilingBand = bands[`z${band.ceiling}` as keyof ZoneBands];
    if (!floorBand || !ceilingBand) return null;
    bpmLow = floorBand.low;
    bpmHigh = ceilingBand.high;
    source = 'zone_band';
    notes.push(`No bpm range in the plan — used the ${band.label} band (${bpmLow}-${bpmHigh} bpm).`);
  }

  // Anything after the closing paren is real coaching intent the percentages
  // cannot carry ("on climbs", "+ bursts"). Surface it rather than drop it.
  // Strip up to the closing paren only when there IS one — otherwise the
  // replace is a no-op and the whole string reads as "trailing" text.
  const trailing = targetBpm
    ? (workout.target_hr ?? '').replace(/^.*\)/, '').trim()
    : extraAfterZone(workout.target_hr);
  if (trailing) notes.push(`Plan also says: "${trailing}".`);

  // Elevation travels as a NOTE, never as a workout step.
  //
  // intervals.icu's parser understands duration, HR, pace and power — there is
  // no elevation step, and inventing syntax it does not know risks malforming
  // the whole workout rather than adding a field to it. A note lands on the
  // calendar and the watch as text the athlete can actually read mid-session,
  // which is what a climb target is for.
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

  const steps: WorkoutStep[] = [
    {
      kind: 'steady',
      minutes,
      pctLow: bpmToPct(bpmLow, maxHr, 'low'),
      pctHigh: bpmToPct(bpmHigh, maxHr, 'high'),
    },
  ];

  return { description: renderWorkoutDescription(steps), bpmLow, bpmHigh, minutes, source, notes };
}

/** Trailing text when there was no parenthetical at all, e.g. "Z1-Z2 + bursts". */
function extraAfterZone(targetHr: string | null | undefined): string {
  if (!targetHr) return '';
  return targetHr.replace(/^\s*z\s*\d(?:\s*[-–—to]+\s*z?\s*\d)?/i, '').trim();
}
