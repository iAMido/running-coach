/**
 * Types for the staged plan builder. See ./runner.ts for the stage machine
 * and supabase/migrations/20260927_plan_builds.sql for why it is staged.
 */

import type { z } from 'zod';
import type { planGenerationSchema } from '@/lib/validation/schemas';
import type { PlanWeek, PlannedStrength } from '@/lib/db/types';

export type BuildRequest = z.infer<typeof planGenerationSchema>;

export type BuildStage =
  | 'created' | 'prepared' | 'outlined' | 'written' | 'checked'
  | 'coherence_fix' | 'reviewed' | 'done' | 'failed';

/**
 * Step 1 — where the athlete is now. Numbers the checks rely on, plus the
 * rendered text the models read. Every number is null when unmeasured:
 * "no climbing recorded" and "0 m climbed" lead to different plans.
 */
export interface AthleteBrief {
  /** Mean of the last 4 COMPLETE weeks. */
  recentWeeklyKm: number | null;
  recentWeeklyVertM: number | null;
  peakWeeklyKm12w: number | null;
  longestRunKm6w: number | null;
  /** Days the plan may use — the request's, else the profile's. */
  allowedDays: string[] | null;
  /** Days he actually ran on over the window, most frequent first. */
  actualRunDays: { day: string; runs: number }[];
  /** Allowed days he has rarely or never run on — a plan built on them may not be run. */
  dayMismatch: string | null;
  text: string;
}

/** Step 2 — what the race demands, and the gap to it. */
export interface RaceBrief {
  distanceKm: number | null;
  elevationGainM: number | null;
  vertPerKm: number | null;
  /** Weeks from the plan start to race day, inclusive of race week. */
  weeksToRace: number | null;
  /** Set when the requested duration does not end on race week. */
  durationNote: string | null;
  hasElevation: boolean;
  text: string;
}

/** Step 3 — what the methodology says about each need this race creates. */
export interface Research {
  needs: { need: string; query: string; excerpt: string; sources: string[] }[];
  /** 3-layer RAG context (athlete data, previous coach, books), pre-rendered. */
  coachContext: string;
  exemplarsText: string;
  exemplarNames: string[];
  macroText: string;
  macroPlanId: string | null;
  macroPhase: string | null;
  intakeBlock: string;
  raceDemandBlock: string;
  bookSources: string[];
}

export interface PreparedStage {
  /**
   * Sunday that week 1 begins, YYYY-MM-DD. Saved as the plan's start_date.
   * Not "today": week 1 is the Sunday-Saturday week containing start_date, so
   * a plan built on a Saturday used to begin with a week that was already over.
   */
  startDate: string;
  /** Runs already logged in week 1 when it starts this week. */
  weekOneSoFar: { runs: number; km: number } | null;
  athlete: AthleteBrief;
  race: RaceBrief;
  research: Research;
  /** Days the plan may use, rendered for prompts ("Sunday, Monday (quality)"). */
  trainingDaysText: string | null;
}

export interface OutlinePhase {
  name: string;
  start_week: number;
  end_week: number;
  purpose: string;
  key_sessions: string[];
  strength_focus: string;
  exit_criteria: string[];
}

export interface OutlineWeek {
  week: number;
  phase: string;
  focus: string;
  total_km: number;
  total_elevation_gain_m?: number | null;
  long_run_km: number;
  is_recovery: boolean;
  quality_sessions: number;
  /** Ids from strength_sessions, one per strength session that week. */
  strength: string[];
}

/** Step 4 — the contract every phase writer follows. */
export interface PlanOutline {
  plan_name: string;
  methodology: string;
  goal: string;
  rationale: string;
  sources: string[];
  /** Which training day carries which role, e.g. { Monday: 'quality' }. */
  day_roles: Record<string, string>;
  phases: OutlinePhase[];
  weeks: OutlineWeek[];
  strength_sessions: Record<string, PlannedStrength>;
  /** Season-level decisions (poles, fuelling) stated rather than left implicit. */
  decisions: string[];
  /** What normalizeOutline had to repair in the model's outline. */
  repaired?: string[];
}

export type Severity = 'error' | 'warn';

/** One broken rule, precise enough to hand back to a writer as a fix. */
export interface Violation {
  rule: string;
  severity: Severity;
  week: number | null;
  day?: string;
  message: string;
}

export interface CheckReport {
  violations: Violation[];
  errors: number;
  warnings: number;
  /** Weeks rewritten to clear errors, in the order it happened. */
  repairs: { round: number; weeks: number[]; errorsBefore: number; errorsAfter: number }[];
}

/** Step 7 — does it all fit. */
export interface CoherenceIssue {
  severity: 'must_fix' | 'note';
  weeks: number[];
  problem: string;
  fix: string;
  /** 'code' for measured joins, 'coach' for the head coach's judgement. */
  source: 'code' | 'coach';
}

export interface CoherenceReview {
  round: number;
  verdict: 'coherent' | 'needs_changes';
  summary: string;
  issues: CoherenceIssue[];
  /** Set once this round's must-fix issues were handed to writers. */
  fixApplied?: boolean;
}

/** Saved with the plan so the athlete can see how it was built and checked. */
export interface BuildReport {
  build_id: string;
  rationale: string;
  phases: OutlinePhase[];
  decisions: string[];
  athlete_notes: string[];
  checks: { errors: number; warnings: number; repaired_weeks: number[]; remaining: Violation[] };
  coherence: { rounds: number; verdict: string; summary: string; addressed: CoherenceIssue[]; open: CoherenceIssue[] };
  models: Record<string, string>;
  seconds: number;
}

export interface PlanBuildRow {
  id: string;
  user_id: string;
  stage: BuildStage;
  request: BuildRequest;
  prepared: PreparedStage | null;
  outline: PlanOutline | null;
  weeks: PlanWeek[] | null;
  checks: CheckReport | null;
  reviews: CoherenceReview[];
  review_rounds: number;
  plan_id: string | null;
  error: string | null;
  timings: Record<string, { ms: number; tokens?: number; thinking?: number }>;
  dry_run: boolean;
  running_until: string | null;
  attempts: Record<string, number>;
  created_at: string;
  updated_at: string;
}
