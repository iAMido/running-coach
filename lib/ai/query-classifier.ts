/**
 * Single-call query classifier. Replaces the keyword regex in
 * lib/rag/context-builder.ts with a tiny Haiku call that returns a
 * structured classification: queryType + workoutType + tags.
 *
 * Why Haiku, not keyword regex:
 *  - Hebrew + slang + negation cases (e.g. "no easy run today" used to
 *    match the keyword 'easy' and pull easy-run books — opposite intent)
 *  - Compound queries ("review last week and propose next") where the
 *    keyword detector arbitrarily picks one
 *  - Implicit phrasing ("should I worry about this calf?")
 *
 * Why Haiku, not Sonnet:
 *  - Classification is a small labelling task; Haiku's ceiling is the
 *    same as Sonnet's for this. Sonnet's extra reasoning is wasted.
 *  - Budget-hygiene: never spend more on the routing decision than on
 *    the call it routes to.
 *  - Latency: classification runs before every chat response.
 *
 * Robustness: any error falls back to the keyword-based logic, so a
 * Haiku outage degrades gracefully to the prior behaviour.
 */

import { callOpenRouter } from '@/lib/ai/openrouter';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import type { QueryType } from '@/lib/rag/types';

export interface QueryClassification {
  queryType: QueryType;
  workoutType?: string;
  tags: string[];
  source: 'llm' | 'fallback';
}

const VALID_QUERY_TYPES: QueryType[] = [
  'daily_advice',
  'plan_review',
  'plan_generation',
  'ask_coach',
  'grocky',
];

const VALID_WORKOUT_TYPES = [
  'Easy', 'Tempo', 'Intervals', 'Long Run', 'Fartlek', 'Race', 'Warmup', 'Cooldown',
];

const CLASSIFIER_PROMPT = `You classify a runner's chat query into routing metadata for a RAG-driven AI coach. Return JSON only.

Pick exactly one queryType:
- daily_advice: "should I run today?", "what's the workout?", "is my HR too high?", "feeling tired"
- plan_review: "how was my week?", "review my training", "analyze last week"
- plan_generation: "create a plan", "build me a 12-week marathon plan"
- ask_coach: general questions, methodology questions, anything that isn't one of the above
- grocky: explicitly asking for a second opinion or "Grocky"

Optionally extract:
- workoutType: one of Easy, Tempo, Intervals, Long Run, Fartlek, Race, Warmup, Cooldown — only if the query is about that workout
- tags: up to 5 short lowercase tags from this set when applicable: base, build, specific, taper, lt1, lt2, vo2, norwegian, triphasic, 80/20, marathon, half-marathon, 10k, 5k, injury, recovery, return, plan, review

Rules:
- Handle Hebrew, slang, negation correctly (e.g. "no easy run today" is daily_advice with NO 'easy' tag)
- If unsure of workoutType, omit it
- Tags must come from the listed set; do not invent

Return ONLY this JSON shape, nothing else:
{"queryType":"...","workoutType":"...optional...","tags":["..."]}`;

export async function classifyQuery(query: string): Promise<QueryClassification> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !query.trim()) {
    return fallbackClassify(query);
  }

  try {
    const resp = await callOpenRouter(
      [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: query.slice(0, 1500) },
      ],
      { apiKey, model: MODEL_FOR.classification, maxTokens: 200 },
    );

    if (resp.error || !resp.content) {
      return fallbackClassify(query);
    }

    const parsed = safeParseJson(resp.content);
    if (!parsed) return fallbackClassify(query);

    const queryType = VALID_QUERY_TYPES.includes(parsed.queryType as QueryType)
      ? (parsed.queryType as QueryType)
      : 'ask_coach';
    const workoutType = typeof parsed.workoutType === 'string' && VALID_WORKOUT_TYPES.includes(parsed.workoutType)
      ? parsed.workoutType
      : undefined;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 5)
      : [];

    return { queryType, workoutType, tags, source: 'llm' };
  } catch {
    return fallbackClassify(query);
  }
}

// ── Fallback (legacy keyword path) ─────────────────────────────────────

function fallbackClassify(query: string): QueryClassification {
  return {
    queryType: detectQueryTypeKeyword(query),
    workoutType: inferWorkoutTypeKeyword(query),
    tags: [],
    source: 'fallback',
  };
}

function detectQueryTypeKeyword(message: string): QueryType {
  const m = message.toLowerCase();
  if (m.includes('today') || m.includes('should i run') || m.includes('what should i do') || m.includes('suggest a workout')) return 'daily_advice';
  if (m.includes('how was my week') || m.includes('weekly review') || m.includes('analyze my') || m.includes('how did i do')) return 'plan_review';
  if (m.includes('create a plan') || m.includes('build a plan') || m.includes('generate a plan') || m.includes('training plan for') || m.includes('week plan')) return 'plan_generation';
  return 'ask_coach';
}

function inferWorkoutTypeKeyword(query: string): string | undefined {
  const q = query.toLowerCase();
  const map: Record<string, string> = {
    'easy': 'Easy', 'recovery': 'Easy',
    'tempo': 'Tempo', 'threshold': 'Tempo',
    'interval': 'Intervals', 'speed': 'Intervals', 'track': 'Intervals', 'repeat': 'Intervals',
    'long run': 'Long Run', 'long': 'Long Run', 'endurance': 'Long Run',
    'fartlek': 'Fartlek', 'race': 'Race', 'warm': 'Warmup', 'cool': 'Cooldown',
  };
  for (const [k, v] of Object.entries(map)) if (q.includes(k)) return v;
  return undefined;
}

function safeParseJson(s: string): Record<string, unknown> | null {
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}
