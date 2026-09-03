/**
 * When is a plan change actually warranted?
 *
 * Pure, so the rules are testable without a database or an LLM — and so they
 * can be argued with. Everything here is computable from `TrainingState` plus
 * the current macro phase; a trigger that needed a judgement call would put the
 * model in charge of deciding whether to call itself.
 *
 * ## Why hysteresis
 *
 * A loop that reacts to every wobble produces an incoherent plan and trains the
 * athlete to ignore it. Weekly volume swings on one missed session — an 8 km run
 * out of a 30 km week is 27% — so the thresholds below are set where a normal
 * week cannot reach them, and every non-urgent trigger requires the signal to
 * persist rather than appear once.
 *
 * **"No change" is the expected weekly outcome.** If this fires most weeks, the
 * thresholds are wrong, not the athlete.
 */

import type { MacroPhase } from '@/lib/coach/macro-plan';
import type { TrainingState } from '@/lib/coach/training-state';

export type TriggerCode =
  | 'ramp_too_fast'
  | 'volume_collapsed'
  | 'low_adherence'
  | 'vert_below_phase'
  | 'efficiency_declining'
  | 'phase_overrun';

export interface Trigger {
  code: TriggerCode;
  /** Plain language, and it must name the number that fired it. */
  detail: string;
  /** Urgent triggers skip the sustained-signal requirement. */
  urgent: boolean;
}

/**
 * Volume ramp beyond this is worth a look regardless of how good it feels.
 *
 * 30% over a two-week-vs-two-week comparison, not the weekly 10% rule of thumb:
 * this is already an average of averages, so it smooths the ordinary noise the
 * 10% rule trips over.
 */
export const RAMP_LIMIT_PCT = 30;

/** A drop this large is either injury, illness or life — all worth asking about. */
export const COLLAPSE_LIMIT_PCT = -30;

/** Below this share of runs on stated days, the plan is being written for the wrong week. */
export const ADHERENCE_FLOOR = 0.5;

/** Enough runs that an adherence rate means something. */
export const ADHERENCE_MIN_RUNS = 6;

/** Efficiency decline vs the season-matched baseline that is worth surfacing. */
export const EFFICIENCY_DECLINE_PCT = -5;

/** Consecutive completed weeks a phase's vert floor must be missed before it counts. */
export const VERT_MISS_WEEKS = 2;

export interface TriggerInput {
  state: TrainingState;
  /** The macro phase this block serves, when there is one. */
  phase: MacroPhase | null;
  /** Weeks elapsed in the current phase, when known. */
  weeksIntoPhase: number | null;
}

export function evaluateTriggers({ state, phase, weeksIntoPhase }: TriggerInput): Trigger[] {
  const triggers: Trigger[] = [];

  // --- volume ramp / collapse -------------------------------------------
  // Both read the two-vs-two week comparison, which already excludes the
  // in-progress week. A partial week counted as a full one made this fire
  // every Thursday during development.
  const vol = state.volumeKm;
  if (vol.pctChange !== null) {
    if (vol.pctChange > RAMP_LIMIT_PCT) {
      triggers.push({
        code: 'ramp_too_fast',
        detail: `Volume up ${vol.pctChange.toFixed(0)}% (${vol.prior?.toFixed(0)} to ${vol.recent?.toFixed(0)} km/wk) — beyond the ${RAMP_LIMIT_PCT}% ramp limit.`,
        urgent: true,
      });
    } else if (vol.pctChange < COLLAPSE_LIMIT_PCT) {
      triggers.push({
        code: 'volume_collapsed',
        detail: `Volume down ${Math.abs(vol.pctChange).toFixed(0)}% (${vol.prior?.toFixed(0)} to ${vol.recent?.toFixed(0)} km/wk).`,
        urgent: true,
      });
    }
  }

  // --- adherence ---------------------------------------------------------
  // Null rate means training_days is unset, which is a gap, not a failure —
  // and must never be scored as 0% adherence.
  if (state.adherence.rate !== null && state.adherence.totalRuns >= ADHERENCE_MIN_RUNS) {
    if (state.adherence.rate < ADHERENCE_FLOOR) {
      triggers.push({
        code: 'low_adherence',
        detail:
          `Only ${state.adherence.runsOnPlannedDays} of ${state.adherence.totalRuns} runs landed on stated training days ` +
          `(${(state.adherence.rate * 100).toFixed(0)}%). The plan may be written for the wrong week.`,
        urgent: false,
      });
    }
  }

  // --- vert against the phase's floor ------------------------------------
  if (phase?.weekly_vert_range_m) {
    const [floor] = phase.weekly_vert_range_m;
    const completed = state.weeks.filter((w) => !w.isPartial);
    const recent = completed.slice(-VERT_MISS_WEEKS);
    // Only judge weeks that actually carry elevation. A week with no reading
    // is unmeasured, and treating it as 0 m would fire this on missing data.
    const measured = recent.filter((w) => w.vertM !== null);
    if (measured.length === VERT_MISS_WEEKS && measured.every((w) => (w.vertM as number) < floor)) {
      triggers.push({
        code: 'vert_below_phase',
        detail:
          `${VERT_MISS_WEEKS} consecutive weeks below the phase floor of ${floor} m ` +
          `(${measured.map((w) => `${w.vertM}m`).join(', ')}). The phase's exit criteria are not being approached.`,
        urgent: false,
      });
    }
  }

  // --- efficiency --------------------------------------------------------
  const ef = state.efficiency;
  if (ef.pctVsBaseline !== null && ef.pctVsBaseline < EFFICIENCY_DECLINE_PCT) {
    triggers.push({
      code: 'efficiency_declining',
      detail:
        `Aerobic efficiency ${ef.pctVsBaseline.toFixed(1)}% vs the same period last year. ` +
        `Load may be going in without adaptation coming out.`,
      urgent: false,
    });
  }

  // --- phase overrun -----------------------------------------------------
  if (phase && weeksIntoPhase !== null && weeksIntoPhase > phase.weeks) {
    triggers.push({
      code: 'phase_overrun',
      detail:
        `Week ${weeksIntoPhase} of a ${phase.weeks}-week phase ("${phase.name}"). ` +
        `Check its exit criteria: either they are met and the season should advance, or the phase needs extending deliberately.`,
      urgent: false,
    });
  }

  return triggers;
}

/**
 * Should this week produce a proposal at all?
 *
 * An urgent trigger is enough on its own. Otherwise **two** independent
 * signals must agree, which is the hysteresis: one soft signal is noise, two
 * pointing the same week is a pattern.
 */
export function shouldPropose(triggers: Trigger[]): boolean {
  if (triggers.some((t) => t.urgent)) return true;
  return triggers.length >= 2;
}

/** One line for the "nothing to change" case, so a quiet week still reads as a result. */
export function describeNoChange(triggers: Trigger[]): string {
  if (triggers.length === 0) {
    return 'No change proposed. Nothing crossed a threshold this week — volume, adherence and efficiency are all inside their normal bands.';
  }
  return (
    'No change proposed. One signal is worth watching but a single soft signal is noise, ' +
    'and nothing else agreed with it this week: ' +
    triggers.map((t) => t.detail).join(' ')
  );
}
