/**
 * Prompt for the season layer.
 *
 * Kept out of `coach-prompts.ts`, which is already carrying the persona, the
 * chat blocks, plan generation and the weekly review. This one has a single
 * job and a much smaller output.
 */

import { buildRaceDemandBlock, type RaceDemand } from '@/lib/ai/coach-prompts';
import { formatTrainingState, type TrainingState } from '@/lib/coach/training-state';

export interface MacroPlanParams {
  goalName: string;
  raceDate?: string | null;
  horizonWeeks: number;
  trainingDays?: string;
  runsPerWeek?: number;
  raceDemand?: RaceDemand;
  state?: TrainingState | null;
}

/**
 * How many phases a horizon of this length should carry.
 *
 * Proportional rather than fixed, because the athlete will ask for 11 months,
 * then 6, then 4, and a season model that only works at one length is a
 * per-race special case waiting to rot. The floor matters more than the
 * ceiling: below ~10 weeks there is no room for distinct phases and pretending
 * otherwise produces four "phases" of two weeks that mean nothing.
 */
export function suggestedPhaseCount(horizonWeeks: number): number {
  if (horizonWeeks < 8) return 1;
  if (horizonWeeks < 14) return 2;
  if (horizonWeeks < 24) return 3;
  if (horizonWeeks < 40) return 4;
  return 5;
}

export function buildMacroPlanPrompt(params: MacroPlanParams): string {
  const { goalName, raceDate, horizonWeeks, trainingDays, runsPerWeek, raceDemand, state } = params;
  const phases = suggestedPhaseCount(horizonWeeks);
  const months = (horizonWeeks / 4.345).toFixed(1);

  return `## SEASON PLANNING TASK

Design the SEASON for this athlete — the phase structure that individual
training blocks will be generated against. You are NOT writing workouts here.
Write no daily sessions, no week-by-week schedule. Anything you prescribe at
that level would be fiction ${months} months out and would teach the athlete to
ignore the plan.

### GOAL
- ${goalName}${raceDate ? `\n- Race date: ${raceDate}` : ''}
- Horizon: ${horizonWeeks} weeks (~${months} months)
- Suggested phase count: ${phases} (use your judgement, but do not invent short
  phases to hit a number — a phase shorter than 3 weeks cannot build anything)
${trainingDays ? `- Training days: ${trainingDays}` : ''}${runsPerWeek ? `\n- Runs per week: ${runsPerWeek}` : ''}
${buildRaceDemandBlock(raceDemand)}
${state ? formatTrainingState(state) : ''}

### WHAT EACH PHASE MUST CARRY

**\`capability\`** — the single thing this phase exists to build, in the
athlete's language. "Tolerate 600 m of continuous descent without quad
failure", not "build strength".

**\`exit_criteria\`** — what must be TRUE to advance. This is the most
important field in the plan and the one most likely to be written lazily.

- Every criterion must be checkable against data this app actually holds:
  weekly km, weekly vert (metres and m/km), long-run vert, aerobic decoupling
  as a percentile of the athlete's OWN history, efficiency trend, adherence to
  stated training days, CTL, readiness.
- Make them specific and countable: "3 consecutive weeks at 600+ m of vert with
  decoupling at or below his own median" — not "feels comfortable climbing".
- **Do not use absolute decoupling bands.** This athlete's own median is ~6.8%
  and roughly a third of his runs exceed 8%; Friel's <5/5-8/>8 are defined on
  raw Pa:HR and calibrated on other people. Express it as a percentile against
  himself.
- If a phase's progress genuinely cannot be measured with what is listed above,
  say so in \`focus\` rather than inventing a criterion that looks checkable.

**Ranges, not points.** \`weekly_km_range\` and \`weekly_vert_range_m\` are the
band a block generator works inside, and a range communicates the tolerance a
single number hides.

### RULES
1. **Phases advance on their exit criteria, not the calendar.** Say this in the
   rationale, and size phases knowing they may run long.
2. Progress vert and volume on separate tracks. When they must be cut, **vert
   comes down before km** — climbing is the newer stress and carries the injury
   risk.
3. Descent is its own stressor with its own progression. Do not fold it into
   climbing.
4. If the athlete's measured baseline is far below the goal, the early phases
   exist to close THAT gap. Do not spend months building something already in
   hand.
5. Use the training state above. Where a signal is listed as unmeasurable, plan
   conservatively and say which criterion you could not anchor.
6. Set \`weekly_vert_range_m\` to null for a goal with no elevation component.
   Never [0, 0] — that reads as "deliberately flat" rather than "not applicable".

### OUTPUT FORMAT
Return ONLY a raw JSON object. No markdown fences, no commentary.

{
  "goal_name": "${goalName}",
  "rationale": "2-4 sentences: the shape of the season and why it is this shape for THIS athlete, naming the gap it closes.",
  "phases": [
    {
      "phase_number": 1,
      "name": "Gradient Familiarisation",
      "focus": "Introduce sustained climbing at gradients above anything in his history",
      "weeks": 10,
      "weekly_km_range": [25, 34],
      "weekly_vert_range_m": [300, 700],
      "long_run_vert_ceiling_m": 500,
      "capability": "Complete a 2-hour session at 30+ m/km without walking breaks caused by fatigue",
      "exit_criteria": [
        "3 consecutive weeks at 600+ m weekly vert",
        "One long run at 400+ m with decoupling at or below his own median percentile",
        "Adherence to stated training days at or above 70%"
      ],
      "key_sessions": ["Weekly hill repeats", "Long trail run with sustained climb"]
    }
  ]
}

The phases must sum to approximately ${horizonWeeks} weeks.`;
}
