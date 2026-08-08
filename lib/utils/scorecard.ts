/**
 * Weekly scorecard — a scannable summary of the week, over metrics that
 * already exist and already carry their own caveats.
 *
 * ## Not every row may carry a colour, and that is the design
 *
 * A green/amber/red scorecard is a verdict system, and this project has
 * consistently chosen context over verdicts. Only two axes here are entitled to
 * a colour:
 *
 * - **Zone discipline** — measured against the plan's OWN stated target, with a
 *   30% threshold that already exists in `zone-discipline.ts`. The comparison is
 *   the athlete's own intent against his own zones; nothing is imported.
 * - **Recovery** — `computeReadiness` already emits GO/EASY/REST. That is a
 *   colour by another name, so rendering it as one adds no new claim.
 *
 * **Aerobic control must NOT carry a colour.** Decoupling renders as a
 * percentile against this athlete's own history precisely because Friel's
 * <5/5-8/>8 bands are defined on RAW Pa:HR and calibrated on other athletes,
 * while this figure is grade-adjusted. On his own 66 runs the median is 6.5%
 * with 25 above 8% — the bands would call a third of his easy running "too
 * hard". Colouring the row would reimport those bands through the presentation
 * layer immediately after they were deliberately kept out of the data layer,
 * and a reader could not tell which rows are measured judgments and which are
 * inherited conventions dressed as one.
 *
 * Efficiency Factor is deliberately absent. It is a 42-day rolling median, so
 * on a weekly artefact it would be the one row that does not change when the
 * week does.
 *
 * ## Type-level guard
 *
 * `ScorecardRow` is a discriminated union: a row with `colour: null` MUST carry
 * `colourless`, so a colourless row cannot be added without explaining itself.
 * The reverse — someone later giving the aerobic row a colour — is guarded by a
 * test, since no type can express it.
 *
 * ## Sample size travels with the card
 *
 * A card computed over 2 runs is a different object from one computed over 5,
 * and nothing on the card itself would otherwise say which. The header carries
 * the week, the run count, and how many of those runs have valid zones — the
 * same discipline as the efficiency block reporting its own window.
 */

import { judgeZoneDiscipline, type ZoneDistribution } from '@/lib/utils/zone-discipline';
import { percentileOf, medianOf } from '@/lib/utils/decoupling';
import type { ReadinessVerdict } from '@/lib/utils/readiness';

export type ScoreColour = 'good' | 'warn' | 'bad';

interface ScorecardRowBase {
  /** Stable key for the UI; not shown. */
  key: 'zone_discipline' | 'recovery' | 'aerobic_control';
  axis: string;
  /** The headline figure or verdict. */
  value: string;
  /** Provenance — the numbers the value rests on. */
  detail: string;
}

export type ScorecardRow =
  | (ScorecardRowBase & { colour: ScoreColour })
  | (ScorecardRowBase & {
      colour: null;
      /** Why this row has no verdict. Required — see the header. */
      colourless: string;
      /**
       * 0-100 position in the athlete's own distribution, when the row is
       * colourless because it is a percentile rather than because it is
       * unmeasurable. Lets the UI render a bar, so the row reads as a
       * different KIND of row rather than as a missing value.
       */
      percentile?: number;
      /**
       * Percentiles of the week's LOWEST and HIGHEST individual values.
       *
       * A single pin drawn from a 2-run median asserts a precision the sample
       * does not carry. These are the observed spread — the actual runs, not a
       * modelled confidence interval, which would be a fabrication of exactly
       * the kind this card refuses elsewhere. Equal to `percentile` when the
       * week holds one run, which the UI renders as a soft mark instead.
       */
      percentileLow?: number;
      percentileHigh?: number;
      /** How many runs the percentile rests on. */
      sampleCount?: number;
    });

export interface Scorecard {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  runCount: number;
  /** Zone analysis is only valid where pct_z1 is non-null — see CLAUDE.md. */
  runsWithZones: number;
  rows: ScorecardRow[];
}

export interface ScorecardRun {
  date: string;
  runType: string | null;
  zones: ZoneDistribution | null;
  decouplingPct: number | null;
  /** The plan's target_hr for that day, when the day was planned. */
  plannedTargetHr: string | null;
  plannedType: string | null;
}

export interface ScorecardInput {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  runs: ScorecardRun[];
  readiness: ReadinessVerdict | null;
  /** Every decoupling value this athlete has, for the percentile. */
  decouplingHistory: number[];
}

/** Below this the percentile is too coarse to mean anything (matches decoupling.ts). */
const MIN_HISTORY_FOR_PERCENTILE = 10;

/**
 * A verdict must cover at least this fraction of the week's runs.
 *
 * Without a threshold, "enough data" was never actually defined: a week with
 * one judged run out of three took a green tick, and the disclosure explaining
 * that two runs went unexamined sat in small text underneath. A green glyph is
 * what the eye takes, and one run out of three is not a green week — it is an
 * unmeasured one.
 *
 * A half is the honest place to draw it: below that, the verdict describes the
 * minority of the week and the majority is unknown. A week with a single run,
 * judged, is fully covered and keeps its colour — coverage, not sample size, is
 * what is being tested.
 */
export const MIN_JUDGED_COVERAGE = 0.5;

function zoneDisciplineRow(runs: ScorecardRun[]): ScorecardRow {
  const judged = runs
    .map((r) => ({ run: r, result: judgeZoneDiscipline({ targetHr: r.plannedTargetHr, plannedType: r.plannedType, zones: r.zones }) }))
    .filter(({ result }) => result.judgement !== 'no_target' && result.judgement !== 'no_zone_data');

  if (judged.length === 0) {
    // Not a pass. A week with no judgable session is a week with no evidence,
    // and green would assert compliance that was never measured.
    const why = runs.length === 0
      ? 'no runs logged this week'
      : 'no run this week had both a planned HR target and valid zone data';
    return {
      key: 'zone_discipline', axis: 'Zone discipline vs plan',
      value: 'Not measurable', detail: why,
      colour: null,
      colourless: `Not measurable — ${why}. An unmeasured week is not a compliant one.`,
    };
  }

  const above = judged.filter(({ result }) => result.judgement === 'above_target');
  const below = judged.filter(({ result }) => result.judgement === 'below_target');
  const flags = above.length + below.length;
  const unjudged = runs.length - judged.length;
  const coverage = judged.length / runs.length;

  const parts: string[] = [];
  if (above.length) parts.push(`${above.length} above target (>30% beyond the planned ceiling)`);
  if (below.length) parts.push(`${below.length} quality session${below.length === 1 ? '' : 's'} below target intensity`);
  if (!parts.length) parts.push('every judged session stayed inside its planned band');
  if (unjudged > 0) {
    parts.push(
      `${unjudged} not judged (no planned HR target, or no zone data) — this does not cover ${unjudged === 1 ? 'it' : 'them'}`,
    );
  }
  const detail = `${parts.join('; ')} · judged against the plan's own target`;

  // Coverage leads, always. It is the number that decides how much the verdict
  // is worth, so it goes where the eye lands rather than in the small print.
  const value = `${judged.length} of ${runs.length} runs judged · ${flags === 0 ? 'all on target' : `${flags} off target`}`;

  if (coverage < MIN_JUDGED_COVERAGE) {
    return {
      key: 'zone_discipline', axis: 'Zone discipline vs plan',
      value, detail,
      colour: null,
      colourless:
        `Not enough judged sessions to grade the week — ${judged.length} of ${runs.length} runs carried both a planned HR target and valid zone data. ` +
        `The judged ${judged.length === 1 ? 'one is' : 'ones are'} described above, but a verdict over ${Math.round(coverage * 100)}% of the week would not be one about the week.`,
    };
  }

  return {
    key: 'zone_discipline', axis: 'Zone discipline vs plan',
    value, detail,
    colour: flags === 0 ? 'good' : flags === 1 ? 'warn' : 'bad',
  };
}

function recoveryRow(readiness: ReadinessVerdict | null): ScorecardRow {
  if (!readiness) {
    return {
      key: 'recovery', axis: 'Recovery',
      value: 'Not measurable', detail: 'no readiness verdict available',
      colour: null,
      colourless: 'Not measurable — no readiness verdict was computed for today.',
    };
  }

  const colour: ScoreColour = readiness.verdict === 'GO' ? 'good' : readiness.verdict === 'EASY' ? 'warn' : 'bad';
  return {
    key: 'recovery', axis: 'Recovery',
    value: readiness.verdict,
    // The first reason is the one that decided it; the rest are disclosures,
    // including the reading-age note when today's have not synced.
    detail: readiness.reasons.join(' '),
    colour,
  };
}

/**
 * Aerobic control. Colourless BY DESIGN — see the header, and the test that
 * asserts it.
 */
function aerobicControlRow(runs: ScorecardRun[], history: number[]): ScorecardRow {
  const week = runs.map((r) => r.decouplingPct).filter((v): v is number => typeof v === 'number');

  if (week.length === 0) {
    return {
      key: 'aerobic_control', axis: 'Aerobic control',
      value: 'Not computed', detail: 'no steady run this week produced a decoupling figure',
      colour: null,
      colourless:
        'Not computed this week — intervals and fartlek are excluded, and a run needs at least 6 laps carrying both pace and HR. Absence is not a clean result.',
    };
  }

  // medianOf returns null on an empty set; `week` is non-empty here, but the
  // types say otherwise and a `!` would be the assertion that hides the day
  // that changes.
  const weekMedian = medianOf(week);
  if (weekMedian === null) {
    return {
      key: 'aerobic_control', axis: 'Aerobic control',
      value: 'Not computed', detail: 'no usable decoupling figure this week',
      colour: null,
      colourless: 'Not computed this week. Absence is not a clean result.',
    };
  }

  const ownMedian = history.length >= MIN_HISTORY_FOR_PERCENTILE ? medianOf(history) : null;
  const pct = history.length >= MIN_HISTORY_FOR_PERCENTILE ? percentileOf(weekMedian, history) : null;

  const detail =
    ownMedian !== null && pct !== null
      ? `${weekMedian.toFixed(1)}% median across ${week.length} steady run${week.length === 1 ? '' : 's'} · your own median is ${ownMedian.toFixed(1)}% over ${history.length} runs`
      : `${weekMedian.toFixed(1)}% median across ${week.length} steady run${week.length === 1 ? '' : 's'} · not enough history yet to place it`;

  // The observed spread, not a modelled interval: the percentiles of the
  // week's own lowest and highest runs.
  const spread =
    pct !== null
      ? {
          percentile: pct,
          percentileLow: percentileOf(Math.min(...week), history) ?? pct,
          percentileHigh: percentileOf(Math.max(...week), history) ?? pct,
          sampleCount: week.length,
        }
      : {};

  return {
    key: 'aerobic_control', axis: 'Aerobic control',
    value: pct !== null ? `p${Math.round(pct)} of your own history` : `${weekMedian.toFixed(1)}%`,
    detail,
    colour: null,
    colourless:
      'No colour on purpose. This decoupling is grade-adjusted, so the conventional 5%/8% bands — defined on raw Pa:HR and calibrated on other athletes — do not apply to it. On this athlete\'s own history the median is 6.5%, which those bands would call a fade. Read the percentile against himself.',
    ...spread,
  };
}

export function buildScorecard(input: ScorecardInput): Scorecard {
  const runsWithZones = input.runs.filter((r) => typeof r.zones?.pct_z1 === 'number').length;

  return {
    weekLabel: input.weekLabel,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    runCount: input.runs.length,
    runsWithZones,
    rows: [
      zoneDisciplineRow(input.runs),
      recoveryRow(input.readiness),
      aerobicControlRow(input.runs, input.decouplingHistory),
    ],
  };
}

/** The header line, used by both the UI and the prompt so they cannot disagree. */
export function scorecardHeader(card: Scorecard): string {
  return `${card.weekLabel} · ${card.runCount} run${card.runCount === 1 ? '' : 's'} · ${card.runsWithZones} with valid zones · ${card.weekStart} to ${card.weekEnd}`;
}

/** Markdown rendering for the weekly analysis prompt. */
export function formatScorecard(card: Scorecard): string {
  const lines = ['## Weekly scorecard', `(${scorecardHeader(card)})`, ''];
  for (const row of card.rows) {
    const mark = row.colour ? `[${row.colour.toUpperCase()}]` : '[no verdict]';
    lines.push(`- **${row.axis}** ${mark} — ${row.value}. ${row.detail}`);
    if (row.colour === null) lines.push(`  ${row.colourless}`);
  }
  return lines.join('\n');
}
