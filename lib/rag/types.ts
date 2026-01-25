// RAG System Types for AI Running Coach
// Types for coaching books, instructions, schedules, and retrieval

// ============================================
// BOOK METADATA TYPES
// ============================================

export interface CoachingBook {
  id: string;
  title: string;
  author?: string;
  methodology: string;  // "Triphasic", "Norwegian", "80/20", "Daniels"
  tags?: string[];      // ["beginner", "marathon", "base-building"]
  level?: string;       // "beginner", "intermediate", "advanced", "all"
  focus_areas?: string[];  // ["speed", "endurance", "recovery", "injury"]
  phases?: string[];    // ["Base", "Support", "Specific", "Taper"]
  raw_metadata?: BookMetadata;
  created_at?: string;
  updated_at?: string;
}

export interface BookMetadata {
  title: string;
  author?: string;
  methodology: string;
  tags?: string[];
  focus_areas?: string[];
  phases?: string[];
  level?: string;
}

// ============================================
// BOOK INSTRUCTIONS TYPES
// ============================================

export interface BookInstruction {
  id: string;
  book_id: string;
  chapter_number?: number;
  chapter_title?: string;
  section_title?: string;
  content: string;
  key_rules?: string[];
  applies_to_phase?: string;      // "Base", "Build", "Specific", "Taper", "All"
  applies_to_workout_type?: string;  // "Easy", "Tempo", "Intervals", "Long Run", etc.
  embedding?: number[];           // Vector embedding for semantic search
  token_count?: number;
  created_at?: string;
}

export interface InstructionChapter {
  number: number;
  title: string;
  sections: InstructionSection[];
}

export interface InstructionSection {
  title: string;
  content: string;
  key_rules?: string[];
  applies_to_phase?: string;
  applies_to_workout_type?: string;
}

export interface InstructionsData {
  chapters: InstructionChapter[];
}

// ============================================
// BOOK SCHEDULES TYPES
// ============================================

export interface BookSchedule {
  id: string;
  book_id: string;
  plan_name: string;
  target_race?: string;   // "Half Marathon", "Marathon", "10K"
  level?: string;         // "beginner", "intermediate", "advanced"
  duration_weeks?: number;
  weekly_structure?: ScheduleWeek[];
  created_at?: string;
}

export interface ScheduleWeek {
  week: number;
  phase: string;
  total_km?: number;
  focus?: string;
  workouts: Record<string, ScheduleWorkout>;
}

export interface ScheduleWorkout {
  type: string;
  distance_km?: number;
  duration_min?: number;
  description?: string;
  target_zone?: string;
  target_pace?: string;
  recovery?: string;
  notes?: string;
}

export interface PlanTemplate {
  name: string;
  target_race: string;
  level: string;
  weeks: ScheduleWeek[];
}

export interface SchedulesData {
  plan_templates: PlanTemplate[];
}

// ============================================
// UPLOAD PAYLOAD TYPES
// ============================================

export interface BookUploadPayload {
  metadata: BookMetadata;
  instructions: InstructionsData;
  schedules: SchedulesData;
}

// ============================================
// SEARCH & RETRIEVAL TYPES
// ============================================

export interface SearchInstructionsParams {
  query: string;
  phase?: string;
  workoutType?: string;
  maxTokens?: number;
  limit?: number;
  threshold?: number;
}

export interface SearchSchedulesParams {
  targetRace?: string;
  level?: string;
  durationWeeks?: number;
}

export interface InstructionSearchResult {
  id: string;
  book_id: string;
  book_title: string;
  methodology: string;
  chapter_title?: string;
  section_title?: string;
  content: string;
  key_rules?: string[];
  similarity: number;
}

export interface ScheduleSearchResult {
  id: string;
  book_id: string;
  book_title: string;
  methodology: string;
  plan_name: string;
  target_race?: string;
  level?: string;
  duration_weeks?: number;
  weekly_structure: ScheduleWeek[];
}

// ============================================
// QUERY TYPES & WEIGHTING
// ============================================

export type QueryType =
  | 'daily_advice'     // "What should I do today?"
  | 'plan_review'      // "How was my week?"
  | 'plan_generation'  // "Create a 12-week marathon plan"
  | 'ask_coach'        // General Q&A (default)
  | 'grocky';          // Second opinion (Grok)

export interface ContextWeights {
  userDataWeight: number;   // 0.0 - 1.0
  oldCoachWeight: number;   // 0.0 - 1.0
  bookWeight: number;       // 0.0 - 1.0 (must sum to 1.0)
}

/**
 * Weight distribution per query type
 * User Data: Recent runs, feedback, profile, active plan
 * Old Coach: TrainingPeaks workout library, historical patterns
 * Books: Methodology books (80/20, Triphasic, etc.)
 */
export const QUERY_WEIGHTS: Record<QueryType, ContextWeights> = {
  daily_advice:    { userDataWeight: 0.65, oldCoachWeight: 0.10, bookWeight: 0.25 },
  plan_review:     { userDataWeight: 0.65, oldCoachWeight: 0.10, bookWeight: 0.25 },
  plan_generation: { userDataWeight: 0.35, oldCoachWeight: 0.10, bookWeight: 0.55 },
  ask_coach:       { userDataWeight: 0.55, oldCoachWeight: 0.10, bookWeight: 0.35 },
  grocky:          { userDataWeight: 0.55, oldCoachWeight: 0.10, bookWeight: 0.35 },
};

export const TOTAL_CONTEXT_TOKENS = 8000;

// ============================================
// CONTEXT BUILDER TYPES
// ============================================

export interface ContextConfig {
  totalTokens: number;        // Default 8000
  userDataWeight: number;     // Default varies by query type
  oldCoachWeight: number;     // Default 0.10
  bookWeight: number;         // Default varies by query type
}

export interface UserContext {
  profile: import('@/lib/db/types').AthleteProfile | null;
  recentRuns: import('@/lib/db/types').Run[];
  activePlan: import('@/lib/db/types').TrainingPlan | null;
  feedback: import('@/lib/db/types').RunFeedback[];
  weeklySummary: import('@/lib/db/types').WeeklySummary | null;
}

export interface CoachContext {
  workouts: import('@/lib/db/types').CoachWorkout[];
  phases: import('@/lib/db/types').CoachPhase[];
}

export interface BookContext {
  instructions: InstructionSearchResult[];
  schedules?: ScheduleSearchResult[];
  totalTokens: number;
}

// ============================================
// FORMATTED CONTEXT TYPES (for AI prompts)
// ============================================

export interface FormattedUserContext {
  text: string;
  tokenCount: number;
  metadata: {
    runsIncluded: number;
    fatigueScore: number;
    currentPhase: string | null;
    hasActivePlan: boolean;
  };
}

export interface FormattedCoachContext {
  text: string;
  tokenCount: number;
  workoutsIncluded: string[];
  phasesIncluded: string[];
}

export interface FormattedBookContext {
  text: string;
  tokenCount: number;
  sources: {
    bookTitle: string;
    methodology: string;
    chapterTitle?: string;
  }[];
}

export interface EnhancedContext {
  userContext: FormattedUserContext;
  coachContext: FormattedCoachContext;
  bookContext: FormattedBookContext;
  combinedPrompt: string;
  totalTokens: number;
  queryType: QueryType;
}

// Legacy interface for backwards compatibility
export interface LegacyEnhancedContext {
  userData: UserContext;
  bookContext: BookContext;
  currentPhase?: string;
  formattedUserContext: string;
  formattedBookContext: string;
}

// ============================================
// PLAN GENERATION TYPES
// ============================================

export interface PlanGenerationRequest {
  planType: string;        // "Half Marathon", "Marathon", "10K", "5K"
  durationWeeks: number;   // 8, 12, 16, etc.
  level?: string;          // "beginner", "intermediate", "advanced"
  runsPerWeek?: number;    // 3-6
}

export interface GeneratedPlanWithSources {
  plan: import('@/lib/db/types').PlanData;
  sources: {
    bookTitle: string;
    methodology: string;
    planName?: string;
  }[];
  rawResponse?: string;
}

// ============================================
// DATABASE TABLE TYPES (for Supabase)
// ============================================

export interface CoachingBooksTable {
  Row: CoachingBook;
  Insert: Omit<CoachingBook, 'id' | 'created_at' | 'updated_at'>;
  Update: Partial<Omit<CoachingBook, 'id'>>;
}

export interface BookInstructionsTable {
  Row: BookInstruction;
  Insert: Omit<BookInstruction, 'id' | 'created_at'>;
  Update: Partial<Omit<BookInstruction, 'id'>>;
}

export interface BookSchedulesTable {
  Row: BookSchedule;
  Insert: Omit<BookSchedule, 'id' | 'created_at'>;
  Update: Partial<Omit<BookSchedule, 'id'>>;
}
