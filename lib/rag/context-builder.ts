import { formatUserContext } from './user-formatter';
import { buildTrainingState, formatTrainingState } from '@/lib/coach/training-state';
import { retrieveCoachContext } from './coach-retriever';
import { retrieveBookContext } from './book-retriever';
import {
  type QueryType,
  type EnhancedContext,
  type FormattedUserContext,
  type FormattedCoachContext,
  type FormattedBookContext,
  QUERY_WEIGHTS,
  TOTAL_CONTEXT_TOKENS,
  TOKEN_BUDGETS_PER_QUERY,
} from './types';
import { getActivePlan } from '@/lib/db/plans';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { classifyQuery } from '@/lib/ai/query-classifier';
import type { TrainingPlan, AthleteProfile } from '@/lib/db/types';

/**
 * Build enhanced context for AI coach
 * Orchestrates all three layers: User Data, Old Coach, Books
 * Applies appropriate weighting based on query type
 */
export interface BuildContextPreload {
  /** Active plan already fetched by the route. Pass `null` explicitly for
   *  "we checked, there is none" — undefined means "not fetched, go fetch". */
  plan?: TrainingPlan | null;
  /** Athlete profile already fetched by the route. Same null/undefined
   *  semantics as plan. */
  profile?: AthleteProfile | null;
}

export async function buildContext(
  userId: string,
  query: string,
  queryType: QueryType,
  preload: BuildContextPreload = {},
): Promise<EnhancedContext> {
  // Get weights and per-query budget for this query type
  const weights = QUERY_WEIGHTS[queryType];
  const totalBudget = TOKEN_BUDGETS_PER_QUERY[queryType] ?? TOTAL_CONTEXT_TOKENS;

  // Calculate token budgets for each layer
  const userTokens = Math.floor(totalBudget * weights.userDataWeight);
  const coachTokens = Math.floor(totalBudget * weights.oldCoachWeight);
  const bookTokens = Math.floor(totalBudget * weights.bookWeight);

  // Only genuinely user-authored free text needs the Haiku classifier.
  // plan_review / plan_generation / daily_advice arrive with fixed or
  // template query strings — paying an LLM round-trip to classify a
  // constant was pure latency. For those we synthesize the classification
  // deterministically.
  const needsLlmClassification = queryType === 'ask_coach' || queryType === 'grocky';

  // Plan fetch and classification are independent — run them together.
  // (Previously sequential: ~100ms plan + ~300-800ms Haiku in series on
  // the critical path of every AI call.)
  const [plan, classification] = await Promise.all([
    preload.plan !== undefined ? Promise.resolve(preload.plan) : getActivePlan(userId),
    needsLlmClassification
      ? classifyQuery(query)
      : Promise.resolve({ queryType, workoutType: undefined, tags: [], source: 'fallback' as const }),
  ]);

  // Compute current week from start_date — the stored current_week_num can
  // drift when the cron that advances it doesn't run.
  const liveWeek = plan?.start_date
    ? calculateCurrentWeek(plan.start_date, plan.duration_weeks).currentWeek
    : (plan?.current_week_num || 1);
  const currentPhase = plan?.plan_json?.weeks?.[liveWeek - 1]?.phase;

  const workoutType = classification.workoutType;
  // Category mirrors workoutType for the coach-retriever's substring search;
  // when the classifier didn't pick a workout we leave it undefined.
  const category = workoutType;
  // Combine LLM-extracted tags with deterministic phase/queryType hints
  // so the retriever still has anchors even when the classifier yields
  // nothing topical.
  const userResourceTags = Array.from(new Set([
    ...classification.tags,
    ...(currentPhase ? [currentPhase.toLowerCase()] : []),
    ...(workoutType ? [workoutType.toLowerCase()] : []),
    ...(queryType === 'plan_generation' ? ['plan'] : []),
    ...(queryType === 'plan_review' ? ['review'] : []),
  ])).filter(Boolean);

  // Build all three contexts in parallel; thread the already-fetched plan
  // and profile into the user layer so it doesn't re-query them.
  const [userContext, coachContext, bookContext, trainingState] = await Promise.all([
    formatUserContext(userId, userTokens, { plan, profile: preload.profile }),
    retrieveCoachContext(
      userId,
      query,
      { phase: currentPhase, workoutType, category },
      coachTokens
    ),
    retrieveBookContext(
      query,
      { phase: currentPhase, workoutType, userResourceTags },
      bookTokens,
      userId,
    ),
    // The shared signal object. Same assembly the weekly proposal and the
    // macro re-evaluation read, so the coach's answer and the plan's
    // adjustment can never be reasoning from different numbers — the property
    // `readinessForUser` already enforces for the GO/EASY/REST verdict.
    //
    // Best-effort: it is enrichment, and an outage in one signal must not cost
    // the whole context.
    buildTrainingState(userId, { plan, profile: preload.profile ?? null }).catch((err) => {
      console.error('context-builder: training state unavailable:', err);
      return null;
    }),
  ]);

  // Combine into final prompt
  const combinedPrompt = assembleCombinedPrompt(
    userContext,
    coachContext,
    bookContext,
    queryType,
    trainingState ? formatTrainingState(trainingState) : null,
  );

  // Calculate total tokens used
  const totalTokens =
    userContext.tokenCount +
    coachContext.tokenCount +
    bookContext.tokenCount;

  return {
    userContext,
    coachContext,
    bookContext,
    combinedPrompt,
    totalTokens,
    queryType,
  };
}

/**
 * Assemble the combined context prompt
 * Follows hierarchy: User Data > Old Coach > Books
 */
function assembleCombinedPrompt(
  userContext: FormattedUserContext,
  coachContext: FormattedCoachContext,
  bookContext: FormattedBookContext,
  queryType: QueryType,
  trainingStateText: string | null,
): string {
  const sections: string[] = [];

  // Header based on query type
  sections.push(getContextHeader(queryType));

  // Priority 1: User's actual data
  if (userContext.text) {
    sections.push('--- PRIORITY 1: ATHLETE DATA (Ground Truth) ---');
    sections.push(userContext.text);

    // Add fatigue indicator — or say plainly that there is none to add.
    // A default score rendered here as a real one is what the coach cited as
    // evidence of under-recovery when no feedback had been logged for a month.
    const fatigue = userContext.metadata.fatigueScore;
    sections.push(
      fatigue === null
        ? `\nCurrent Fatigue: not available — no run feedback logged recently. Do not infer a fatigue level from its absence.`
        : `\nCurrent Fatigue: ${fatigue.toFixed(1)}/10 (${getFatigueLevel(fatigue)})`,
    );
  }

  // Still Priority 1 — measured athlete data, aggregated into trends rather
  // than listed per run. Placed AFTER the run list so the model reads the raw
  // evidence first and the summary second, never the reverse.
  if (trainingStateText) {
    sections.push('');
    sections.push(trainingStateText);
  }

  // Priority 2: Old coach patterns
  if (coachContext.text && coachContext.workoutsIncluded.length > 0) {
    sections.push('\n--- PRIORITY 2: PREVIOUS COACH PATTERNS (Proven for this athlete) ---');
    sections.push(coachContext.text);
  }

  // Priority 3: Book methodology
  if (bookContext.text && bookContext.sources.length > 0) {
    sections.push('\n--- PRIORITY 3: METHODOLOGY GUIDELINES (General rules) ---');
    sections.push(bookContext.text);
  }

  return sections.join('\n\n');
}

/**
 * Get context header based on query type
 */
function getContextHeader(queryType: QueryType): string {
  switch (queryType) {
    case 'daily_advice':
      return '=== CONTEXT FOR DAILY TRAINING ADVICE ===';
    case 'plan_review':
      return '=== CONTEXT FOR WEEKLY REVIEW ===';
    case 'plan_generation':
      return '=== CONTEXT FOR TRAINING PLAN GENERATION ===';
    case 'grocky':
      return '=== CONTEXT FOR SECOND OPINION ===';
    default:
      return '=== CONTEXT FOR COACHING RESPONSE ===';
  }
}

/**
 * Get fatigue level description
 */
function getFatigueLevel(score: number): string {
  if (score <= 3) return 'Fresh - Ready for hard training';
  if (score <= 5) return 'Moderate - Normal training load';
  if (score <= 7) return 'Tired - Consider recovery';
  return 'Very Fatigued - Prioritize rest';
}

// inferWorkoutType / inferCategory / inferUserResourceTags removed —
// the Haiku classifier in lib/ai/query-classifier.ts now does all three
// in a single LLM call (and falls back to a keyword path on Haiku
// failure, so the legacy logic is still reachable in degradation mode).

/**
 * Detect query type from user message
 * Useful when queryType is not explicitly provided
 */
export function detectQueryType(message: string): QueryType {
  const msgLower = message.toLowerCase();

  // Daily advice patterns
  if (
    msgLower.includes('today') ||
    msgLower.includes('should i run') ||
    msgLower.includes('what should i do') ||
    msgLower.includes('suggest a workout')
  ) {
    return 'daily_advice';
  }

  // Plan review patterns
  if (
    msgLower.includes('how was my week') ||
    msgLower.includes('weekly review') ||
    msgLower.includes('analyze my') ||
    msgLower.includes('how did i do')
  ) {
    return 'plan_review';
  }

  // Plan generation patterns
  if (
    msgLower.includes('create a plan') ||
    msgLower.includes('build a plan') ||
    msgLower.includes('generate a plan') ||
    msgLower.includes('training plan for') ||
    msgLower.includes('week plan')
  ) {
    return 'plan_generation';
  }

  // Default to general Q&A
  return 'ask_coach';
}

/**
 * Quick context builder for simpler queries
 * Uses default weights and minimal processing
 */
export async function buildQuickContext(
  userId: string,
  query: string
): Promise<{
  userSummary: string;
  /** Null when there is no feedback to compute it from — never a default. */
  fatigueScore: number | null;
  currentPhase: string | null;
}> {
  const userContext = await formatUserContext(userId, 2000);

  return {
    userSummary: userContext.text,
    fatigueScore: userContext.metadata.fatigueScore,
    currentPhase: userContext.metadata.currentPhase,
  };
}

/**
 * Get context statistics for debugging/monitoring
 */
export function getContextStats(context: EnhancedContext): {
  totalTokens: number;
  userTokens: number;
  coachTokens: number;
  bookTokens: number;
  sources: number;
  workoutsIncluded: number;
} {
  return {
    totalTokens: context.totalTokens,
    userTokens: context.userContext.tokenCount,
    coachTokens: context.coachContext.tokenCount,
    bookTokens: context.bookContext.tokenCount,
    sources: context.bookContext.sources.length,
    workoutsIncluded: context.coachContext.workoutsIncluded.length,
  };
}
