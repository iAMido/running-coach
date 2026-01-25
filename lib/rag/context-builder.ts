import { formatUserContext } from './user-formatter';
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
} from './types';
import { getActivePlan } from '@/lib/db/plans';

/**
 * Build enhanced context for AI coach
 * Orchestrates all three layers: User Data, Old Coach, Books
 * Applies appropriate weighting based on query type
 */
export async function buildContext(
  userId: string,
  query: string,
  queryType: QueryType
): Promise<EnhancedContext> {
  // Get weights for this query type
  const weights = QUERY_WEIGHTS[queryType];

  // Calculate token budgets for each layer
  const userTokens = Math.floor(TOTAL_CONTEXT_TOKENS * weights.userDataWeight);
  const coachTokens = Math.floor(TOTAL_CONTEXT_TOKENS * weights.oldCoachWeight);
  const bookTokens = Math.floor(TOTAL_CONTEXT_TOKENS * weights.bookWeight);

  // Get current phase from active plan (needed for filtering)
  const plan = await getActivePlan(userId);
  const currentPhase = plan?.plan_json?.weeks?.[
    (plan.current_week_num || 1) - 1
  ]?.phase;

  // Infer workout type from query
  const workoutType = inferWorkoutType(query);
  const category = inferCategory(query);

  // Build all three contexts in parallel
  const [userContext, coachContext, bookContext] = await Promise.all([
    formatUserContext(userId, userTokens),
    retrieveCoachContext(
      userId,
      query,
      { phase: currentPhase, workoutType, category },
      coachTokens
    ),
    retrieveBookContext(
      query,
      { phase: currentPhase, workoutType },
      bookTokens
    ),
  ]);

  // Combine into final prompt
  const combinedPrompt = assembleCombinedPrompt(
    userContext,
    coachContext,
    bookContext,
    queryType
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
  queryType: QueryType
): string {
  const sections: string[] = [];

  // Header based on query type
  sections.push(getContextHeader(queryType));

  // Priority 1: User's actual data
  if (userContext.text) {
    sections.push('--- PRIORITY 1: ATHLETE DATA (Ground Truth) ---');
    sections.push(userContext.text);

    // Add fatigue indicator
    const fatigueLevel = getFatigueLevel(userContext.metadata.fatigueScore);
    sections.push(`\nCurrent Fatigue: ${userContext.metadata.fatigueScore.toFixed(1)}/10 (${fatigueLevel})`);
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

/**
 * Infer workout type from query
 */
function inferWorkoutType(query: string): string | undefined {
  const queryLower = query.toLowerCase();

  const workoutPatterns: Record<string, string> = {
    'easy': 'Easy',
    'recovery': 'Easy',
    'tempo': 'Tempo',
    'threshold': 'Tempo',
    'interval': 'Intervals',
    'speed': 'Intervals',
    'track': 'Intervals',
    'repeat': 'Intervals',
    'long run': 'Long Run',
    'long': 'Long Run',
    'endurance': 'Long Run',
    'fartlek': 'Fartlek',
    'race': 'Race',
    'warm': 'Warmup',
    'cool': 'Cooldown',
  };

  for (const [pattern, type] of Object.entries(workoutPatterns)) {
    if (queryLower.includes(pattern)) {
      return type;
    }
  }

  return undefined;
}

/**
 * Infer category from query
 */
function inferCategory(query: string): string | undefined {
  const queryLower = query.toLowerCase();

  if (queryLower.includes('recovery') || queryLower.includes('rest') || queryLower.includes('easy')) {
    return 'Easy';
  }
  if (queryLower.includes('tempo') || queryLower.includes('threshold')) {
    return 'Tempo';
  }
  if (queryLower.includes('interval') || queryLower.includes('speed') || queryLower.includes('track')) {
    return 'Intervals';
  }
  if (queryLower.includes('long') || queryLower.includes('endurance')) {
    return 'Long Run';
  }

  return undefined;
}

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
  fatigueScore: number;
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
