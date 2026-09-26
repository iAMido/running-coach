/**
 * What the plan page sees of a build — progress and summaries, never the
 * prompt material. Shared by the API route and the page's types.
 */

import type { TrainingPlan } from '@/lib/db/types';
import type { BuildStage, PlanBuildRow } from './types';

/** Stage labels. Kept here (not in runner.ts) so the client can import them without server code. */
export const STAGE_LABELS: Record<BuildStage, string> = {
  created: 'Assessing athlete, race and research',
  prepared: 'Head coach writing the outline',
  outlined: 'Writing the phases',
  written: 'Checking every rule',
  checked: 'Head coach reviewing the whole plan',
  coherence_fix: 'Fixing what did not fit',
  reviewed: 'Saving the plan',
  done: 'Done',
  failed: 'Failed',
};

/** The visible steps, in order. coherence_fix is shown as part of the review step. */
export const VIEW_STEPS: { stage: BuildStage; title: string }[] = [
  { stage: 'created', title: 'Assess athlete, race & research' },
  { stage: 'prepared', title: 'Outline — the strategy' },
  { stage: 'outlined', title: 'Write the phases in parallel' },
  { stage: 'written', title: 'Rule checks & repairs' },
  { stage: 'checked', title: 'Does it all fit?' },
  { stage: 'reviewed', title: 'Save' },
];

export interface PlanBuildView {
  id: string;
  stage: BuildStage;
  label: string;
  /** Index into VIEW_STEPS of the step now running (VIEW_STEPS.length when done). */
  stepIndex: number;
  busy: boolean;
  error: string | null;
  reviewRound: number;
  athleteNotes: string[];
  research: { needs: { need: string; sources: string[] }[]; references: string[] } | null;
  outline: { planName: string; rationale: string; phases: { name: string; weeks: string; purpose: string }[] } | null;
  checks: { errors: number; warnings: number; repairedWeeks: number[] } | null;
  reviews: { round: number; verdict: string; summary: string; mustFix: number }[];
  seconds: number;
  plan: TrainingPlan | null;
}

export function toView(row: PlanBuildRow, busy: boolean, plan: TrainingPlan | null): PlanBuildView {
  const stage = row.stage === 'coherence_fix' ? 'checked' : row.stage;
  const idx = VIEW_STEPS.findIndex((s) => s.stage === stage);
  return {
    id: row.id,
    stage: row.stage,
    label: STAGE_LABELS[row.stage],
    stepIndex: row.stage === 'done' ? VIEW_STEPS.length : idx,
    busy,
    error: row.error,
    reviewRound: row.review_rounds,
    athleteNotes: [row.prepared?.athlete.dayMismatch, row.prepared?.race.durationNote].filter((x): x is string => !!x),
    research: row.prepared ? {
      needs: row.prepared.research.needs.map((n) => ({ need: n.need, sources: n.sources })),
      references: row.prepared.research.exemplarNames,
    } : null,
    outline: row.outline ? {
      planName: row.outline.plan_name,
      rationale: row.outline.rationale,
      phases: row.outline.phases.map((p) => ({ name: p.name, weeks: `${p.start_week}-${p.end_week}`, purpose: p.purpose })),
    } : null,
    checks: row.checks ? {
      errors: row.checks.errors, warnings: row.checks.warnings,
      repairedWeeks: [...new Set(row.checks.repairs.flatMap((r) => r.weeks))].sort((a, b) => a - b),
    } : null,
    reviews: row.reviews.map((r) => ({
      round: r.round, verdict: r.verdict, summary: r.summary,
      mustFix: r.issues.filter((i) => i.severity === 'must_fix').length,
    })),
    seconds: Math.round(Object.values(row.timings ?? {}).reduce((a, x) => a + x.ms, 0) / 1000),
    plan,
  };
}
