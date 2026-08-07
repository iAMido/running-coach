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

export interface WorkoutTranslation {
  description: string;
  /** The bpm range the percentages were derived from, for the UI to show. */
  bpmLow: number;
  bpmHigh: number;
  minutes: number;
}

/**
 * A planned workout -> a pushable description.
 *
 * v1 emits ONE steady block at the prescribed zone. The plan's `description`
 * carries interval structure as free text ("Main: 4x(6min tempo / 3min easy)"),
 * and parsing that reliably is a separate problem — a mis-parsed interval
 * session on the watch is worse than a correct steady one. `renderWorkoutDescription`
 * already supports repeat blocks, so richer structure is a mapper change only.
 *
 * Returns null when the workout carries no usable zone or duration, so the
 * caller can skip it rather than push something invented.
 */
export function planWorkoutToDescription(
  workout: Workout,
  bands: ZoneBands,
  maxHr: number,
): WorkoutTranslation | null {
  const band = parsePlannedZoneBand(workout.target_hr);
  const minutes = parseDurationMinutes(workout.duration);
  if (!band || !minutes) return null;

  const floorBand = bands[`z${band.floor}` as keyof ZoneBands];
  const ceilingBand = bands[`z${band.ceiling}` as keyof ZoneBands];
  if (!floorBand || !ceilingBand) return null;

  const bpmLow = floorBand.low;
  const bpmHigh = ceilingBand.high;

  const steps: WorkoutStep[] = [
    {
      kind: 'steady',
      minutes,
      pctLow: bpmToPct(bpmLow, maxHr, 'low'),
      pctHigh: bpmToPct(bpmHigh, maxHr, 'high'),
    },
  ];

  return { description: renderWorkoutDescription(steps), bpmLow, bpmHigh, minutes };
}
