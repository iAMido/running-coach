/**
 * Post-flight critic. Fires after the main AI response, calls a cheap
 * Haiku-class model with a tight grading prompt, and persists the result
 * to runcoach.coach_response_audits. Fire-and-forget: never blocks the
 * user-facing response.
 *
 * Goal: spot silent quality regressions over time. When the weekly health
 * audit sees overall_score drifting down on plan_review or seeing
 * "ignored_planned_week" land repeatedly in `missing`, that's our signal
 * that a context-flow bug just shipped.
 */

import { callOpenRouter } from '@/lib/ai/openrouter';
import { supabase } from '@/lib/db/supabase';
import type { QueryType } from '@/lib/rag/types';
import type { CriticAudit, CriticScores, PreflightWarning } from './types';

import { MODEL_FOR } from '@/lib/ai/model-registry';

const CRITIC_MODEL = MODEL_FOR.critic;

export interface CriticInput {
  userId: string;
  callId: string | null;
  route: string;
  queryType: QueryType;
  userQuery: string;
  coachResponse: string;
  /** One-paragraph summary of what was actually in the prompt. */
  contextSummary: string;
  /** Pre-flight warnings to fold into the audit row. */
  preflightWarnings: PreflightWarning[];
}

export interface CriticResult {
  auditId: string | null;
  audit: CriticAudit | null;
  error?: string;
}

function buildCriticPrompt(input: CriticInput): string {
  return `You are an auditor for an AI running coach. Score the COACH RESPONSE on five axes (1=poor, 5=excellent) and report what got ignored or hallucinated.

# USER QUERY
${truncate(input.userQuery, 1000)}

# WHAT THE COACH HAD AVAILABLE IN ITS PROMPT
${truncate(input.contextSummary, 2000)}

# COACH RESPONSE
${truncate(input.coachResponse, 4000)}

# YOUR TASK
Return ONLY valid JSON, no prose, no code fences, matching this shape:
{
  "addresses_question": 1-5,
  "references_plan_day": 1-5,
  "references_runs_feedback": 1-5,
  "specific_pace_hr": 1-5,
  "no_contradiction": 1-5,
  "missing": ["short phrase per ignored fact"],
  "hallucinations": ["short phrase per unsupported claim"],
  "notes": "one short sentence"
}

Scoring rubric:
- addresses_question: did the response answer what the user asked?
- references_plan_day: did it cite the planned workout for today/this week when relevant?
- references_runs_feedback: did it reference the user's actual recent runs and feedback comments?
- specific_pace_hr: did it give concrete pace ranges (min/km) or HR targets/zones?
- no_contradiction: did it stay consistent with the plan/methodology shown above (no contradictions)?

If a rubric item doesn't apply to this query type, score 5.`;
}

export async function runCritic(input: CriticInput): Promise<CriticResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { auditId: null, audit: null, error: 'no_api_key' };

  const start = Date.now();
  const prompt = buildCriticPrompt(input);

  const response = await callOpenRouter(
    [{ role: 'user', content: prompt }],
    { apiKey, model: CRITIC_MODEL, maxTokens: 600 },
  );

  const latencyMs = Date.now() - start;
  if (response.error || !response.content) {
    return { auditId: null, audit: null, error: response.error || 'no_content' };
  }

  const parsed = safeParseJson(response.content);
  const audit = parsed ? normalizeAudit(parsed) : null;

  // Persist regardless of parse success — we want the raw response too.
  const { data, error } = await supabase
    .from('coach_response_audits')
    .insert({
      call_id: input.callId,
      user_id: input.userId,
      route: input.route,
      query_type: input.queryType,
      query_excerpt: truncate(input.userQuery, 500),
      response_excerpt: truncate(input.coachResponse, 1000),
      scores: audit?.scores ?? null,
      overall_score: audit?.overallScore ?? null,
      missing: audit?.missing ?? null,
      hallucinations: audit?.hallucinations ?? null,
      warnings: input.preflightWarnings.map(w => `${w.code}:${w.severity}`),
      critic_model: CRITIC_MODEL,
      critic_latency_ms: latencyMs,
      raw_critic_response: response.content,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { auditId: null, audit, error: error?.message || 'insert_failed' };
  }

  // Back-link the call row to the audit row.
  if (input.callId) {
    await supabase
      .from('coach_calls')
      .update({ audit_id: data.id })
      .eq('id', input.callId);
  }

  return { auditId: data.id, audit };
}

// ── helpers ─────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function safeParseJson(s: string): Record<string, unknown> | null {
  // Strip fences if the model added them despite the prompt
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // try to grab the first {...} block
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAudit(parsed: Record<string, unknown>): CriticAudit | null {
  const clamp = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.max(1, Math.min(5, Math.round(v)));
  };
  const a = clamp(parsed.addresses_question);
  const p = clamp(parsed.references_plan_day);
  const r = clamp(parsed.references_runs_feedback);
  const s = clamp(parsed.specific_pace_hr);
  const c = clamp(parsed.no_contradiction);
  if (a === null || p === null || r === null || s === null || c === null) return null;
  const scores: CriticScores = {
    addresses_question: a,
    references_plan_day: p,
    references_runs_feedback: r,
    specific_pace_hr: s,
    no_contradiction: c,
  };
  const overall = Math.round(((a + p + r + s + c) / 5) * 10) / 10;
  return {
    scores,
    overallScore: overall,
    missing: Array.isArray(parsed.missing) ? parsed.missing.filter((x): x is string => typeof x === 'string') : [],
    hallucinations: Array.isArray(parsed.hallucinations)
      ? parsed.hallucinations.filter((x): x is string => typeof x === 'string')
      : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}
