/**
 * Supervisor types. The supervisor is a deterministic pre-flight gate + an
 * optional post-flight critic that watches every AI call and records what
 * the coach actually saw / produced, so silent gaps (no feedback in the
 * prompt, no books retrieved, no planned week visible) get flagged instead
 * of quietly degrading the response.
 */

import type { QueryType } from '@/lib/rag/types';

/** A single coverage-rule failure or soft warning from pre-flight. */
export interface PreflightWarning {
  /** Stable machine code, e.g. 'no_planned_week', 'no_recent_runs'. */
  code: string;
  /** Human-readable explanation surfaced in metadata / logs. */
  message: string;
  /** 'block' fails the call; 'warn' continues but records the warning. */
  severity: 'warn' | 'block';
}

export interface PreflightResult {
  ok: boolean;
  warnings: PreflightWarning[];
  /** Free-form context the supervisor decided to inject (e.g. "PLAN_HINT: ..."). */
  augmentedSystemSuffix?: string;
}

/** Per-axis grading scores from the critic, each integer 1-5. */
export interface CriticScores {
  addresses_question: number;
  references_plan_day: number;
  references_runs_feedback: number;
  specific_pace_hr: number;
  no_contradiction: number;
}

export interface CriticAudit {
  scores: CriticScores;
  overallScore: number; // mean of the five axes
  missing: string[];
  hallucinations: string[];
  notes?: string;
}

/** Echoed back to the caller on every coach API response. */
export interface SupervisorEnvelope {
  callId: string | null;
  preflightOk: boolean;
  warnings: PreflightWarning[];
  /** Set once the critic call completes; null while fire-and-forget. */
  auditId?: string | null;
}

/** Shape of the row written to runcoach.coach_calls. */
export interface CoachCallRow {
  user_id: string;
  route: string;
  query_type: QueryType | null;
  model: string | null;
  context_tokens: number | null;
  context_budget: number | null;
  ceiling_hit: boolean;
  cache_used: boolean;
  preflight_ok: boolean;
  preflight_warnings: string[] | null;
  preflight_augmented: boolean;
  latency_ms: number | null;
  status: 'ok' | 'error' | 'partial';
  error_message: string | null;
  plan_modified: boolean;
}
