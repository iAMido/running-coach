# RAG System Implementation Plan
## AI Running Coach - Three-Layer Hybrid Retrieval System

**Created:** 2026-01-25
**Updated:** 2026-01-25
**Status:** Planning
**Goal:** Implement a three-layer hybrid retrieval system combining:
1. **User Data** (dynamic) - Recent runs, feedback, profile
2. **Old Coach Data** (semi-static) - TrainingPeaks workout library, historical plans
3. **Books** (static) - Coaching methodology books

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Three-Layer Data Model](#three-layer-data-model)
3. [Weighting Configuration](#weighting-configuration)
4. [Implementation Steps](#implementation-steps)
5. [File Structure](#file-structure)
6. [Database Changes](#database-changes)
7. [API Endpoints](#api-endpoints)
8. [Testing Plan](#testing-plan)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER QUERY                                     │
│              "What should I run today based on my fatigue?"             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONTEXT BUILDER (lib/rag/context-builder.ts)         │
│                                                                         │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐   │
│  │  USER CONTEXT     │  │  OLD COACH        │  │  BOOK CONTEXT     │   │
│  │  (Dynamic)        │  │  (Semi-Static)    │  │  (Static)         │   │
│  │  Weight: 55-65%   │  │  Weight: 10%      │  │  Weight: 25-55%   │   │
│  │                   │  │                   │  │                   │   │
│  │ • Recent runs     │  │ • Workout library │  │ • Semantic search │   │
│  │ • Run feedback    │  │ • Workout names   │  │ • Filtered by:    │   │
│  │ • Weekly summary  │  │ • Training phases │  │   - Phase         │   │
│  │ • Active plan     │  │ • Coach notes     │  │   - Workout type  │   │
│  │ • Athlete profile │  │ • Historical      │  │   - Level         │   │
│  │ • Fatigue score   │  │   patterns        │  │ • Source cited    │   │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    HIERARCHY OF TRUTH                            │   │
│  │  Priority 1: User's actual data (what happened)                  │   │
│  │  Priority 2: Old coach patterns (proven to work for this user)   │   │
│  │  Priority 3: Book methodology (general rules)                    │   │
│  │  Priority 4: AI general knowledge (fallback only)                │   │
│  │                                                                  │   │
│  │  Conflicts: Resolved case-by-case, AI asks user when unclear    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         ASSEMBLED PROMPT                                 │
│                                                                         │
│  SYSTEM: You are the Running Box AI Coach...                           │
│  CONTEXT: [User] + [Old Coach patterns] + [Book excerpts]              │
│  USER: [Original question]                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CLAUDE / GROK RESPONSE                             │
│                                                                         │
│  "Based on your 20km long run yesterday, and considering your          │
│   previous coach typically scheduled 'Recovery Flush' workouts         │
│   after long efforts, plus the Running Box methodology which           │
│   recommends Zone 2 recovery runs - today should be an easy            │
│   30-minute Zone 2 run..."                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Three-Layer Data Model

### Layer 1: User Data (Dynamic)
**Source:** Real-time from Supabase
**Updates:** Every run, every feedback entry

| Data | Table | Purpose |
|------|-------|---------|
| Recent runs (14 days) | `runs` | Current training load, patterns |
| Run feedback | `run_feedback` | Subjective fatigue, effort |
| Weekly summaries | `weekly_summaries` | Sleep, stress, injuries |
| Active plan | `training_plans` | Current week, phase |
| Athlete profile | `athlete_profile` | Goals, HR zones, history |

### Layer 2: Old Coach Data (Semi-Static)
**Source:** TrainingPeaks export / manual import
**Updates:** One-time import, occasional additions

| Data | Table | Purpose |
|------|-------|---------|
| Workout definitions | `coach_workouts` | Named workouts with descriptions |
| Training phases | `coach_phases` | Phase templates (Base, Build, etc.) |
| Workout patterns | Derived from `runs` | Common sequences, recovery patterns |

**Example Old Coach Data:**
```json
{
  "workout_name": "LT2 Intervals",
  "category": "Threshold",
  "description": "4x8min at LT2 pace with 2min recovery",
  "typical_phase": "Build",
  "coach_notes": "Use on Tuesdays, never back-to-back with tempo",
  "frequency": "Weekly during build phase"
}
```

### Layer 3: Books (Static)
**Source:** PDF methodology books, converted to embeddings
**Updates:** When new books are added

| Data | Table | Purpose |
|------|-------|---------|
| Book metadata | `coaching_books` | Title, author, methodology |
| Instructions | `book_instructions` | Chunked content with embeddings |
| Schedules | `book_schedules` | Plan templates |

---

## Weighting Configuration

### Token Budget: 8000 tokens total for context

| Query Type | User Data | Old Coach | Books | Use Case |
|------------|-----------|-----------|-------|----------|
| `daily_advice` | 65% (5200) | 10% (800) | 25% (2000) | "What should I do today?" |
| `plan_review` | 65% (5200) | 10% (800) | 25% (2000) | "How was my week?" |
| `plan_generation` | 35% (2800) | 10% (800) | 55% (4400) | "Create a 12-week marathon plan" |
| `ask_coach` | 55% (4400) | 10% (800) | 35% (2800) | General Q&A (default) |
| `grocky` | 55% (4400) | 10% (800) | 35% (2800) | Second opinion |

### Configuration Interface

```typescript
// lib/rag/types.ts (add to existing)

export type QueryType =
  | 'daily_advice'
  | 'plan_review'
  | 'plan_generation'
  | 'ask_coach'
  | 'grocky';

export interface ContextWeights {
  userDataWeight: number;   // 0.0 - 1.0
  oldCoachWeight: number;   // 0.0 - 1.0
  bookWeight: number;       // 0.0 - 1.0 (must sum to 1.0)
}

export const QUERY_WEIGHTS: Record<QueryType, ContextWeights> = {
  daily_advice:    { userDataWeight: 0.65, oldCoachWeight: 0.10, bookWeight: 0.25 },
  plan_review:     { userDataWeight: 0.65, oldCoachWeight: 0.10, bookWeight: 0.25 },
  plan_generation: { userDataWeight: 0.35, oldCoachWeight: 0.10, bookWeight: 0.55 },
  ask_coach:       { userDataWeight: 0.55, oldCoachWeight: 0.10, bookWeight: 0.35 },
  grocky:          { userDataWeight: 0.55, oldCoachWeight: 0.10, bookWeight: 0.35 },
};

export const TOTAL_CONTEXT_TOKENS = 8000;
```

---

## Implementation Steps

### Phase 0: Database Setup for Old Coach Data
**Priority: HIGH | Estimate: 1-2 hours**

#### Step 0.1: Create Coach Workouts Table
**Migration:** `supabase/migrations/XXXXXX_create_coach_workouts.sql`

```sql
-- Table for old coach workout definitions from TrainingPeaks
CREATE TABLE coach_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,

  -- Workout identification
  workout_name text NOT NULL,
  workout_name_variants text[],  -- Alternative names used

  -- Classification
  category text,                  -- "Easy", "Tempo", "Intervals", "Long Run", "Recovery"
  sub_category text,              -- "LT1", "LT2", "VO2max", etc.
  training_phase text,            -- "Base", "Build", "Specific", "Taper"

  -- Workout details
  description text,               -- Full workout description
  typical_distance_km numeric,
  typical_duration_min numeric,
  target_zone text,               -- "Z2", "Z3", "Z4", etc.
  target_pace text,               -- "4:30/km", "Easy", etc.
  intensity_level integer,        -- 1-10

  -- Coach wisdom
  coach_notes text,               -- Original coach instructions/tips
  when_to_use text,               -- "After rest day", "Mid-week only"
  when_to_avoid text,             -- "Never after intervals"
  recovery_needed text,           -- "24h easy", "48h before race"

  -- Usage stats (derived from runs)
  times_performed integer DEFAULT 0,
  last_performed date,
  avg_feeling numeric,            -- Average user feeling when doing this workout

  -- Metadata
  source text DEFAULT 'trainingpeaks',  -- "trainingpeaks", "manual", "garmin"
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, workout_name)
);

-- Enable RLS
ALTER TABLE coach_workouts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own workouts" ON coach_workouts
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own workouts" ON coach_workouts
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update own workouts" ON coach_workouts
  FOR UPDATE USING (auth.uid()::text = user_id);

-- Index for fast lookups
CREATE INDEX idx_coach_workouts_user ON coach_workouts(user_id);
CREATE INDEX idx_coach_workouts_category ON coach_workouts(user_id, category);
CREATE INDEX idx_coach_workouts_phase ON coach_workouts(user_id, training_phase);
```

#### Step 0.2: Create Coach Phases Table
**Migration:** `supabase/migrations/XXXXXX_create_coach_phases.sql`

```sql
-- Table for old coach training phase definitions
CREATE TABLE coach_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,

  -- Phase identification
  phase_name text NOT NULL,       -- "Base 1", "Build", "Specific", "Taper"
  phase_order integer,            -- 1, 2, 3, 4 (sequence in plan)

  -- Phase details
  description text,
  typical_duration_weeks integer,
  focus_areas text[],             -- ["Aerobic base", "Volume building"]

  -- Workout distribution
  weekly_structure jsonb,         -- {"Monday": "Easy", "Tuesday": "Intervals", ...}
  workout_types text[],           -- ["Easy", "Tempo", "Long Run"]
  intensity_distribution jsonb,   -- {"easy": 80, "moderate": 15, "hard": 5}

  -- Coach wisdom
  coach_notes text,
  key_workouts text[],            -- Most important workouts in this phase
  avoid_in_phase text[],          -- What NOT to do

  -- Progression rules
  volume_progression text,        -- "Increase 10% weekly"
  intensity_progression text,     -- "Hold steady", "Increase tempo distance"

  -- Metadata
  source text DEFAULT 'trainingpeaks',
  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, phase_name)
);

-- Enable RLS
ALTER TABLE coach_phases ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own phases" ON coach_phases
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own phases" ON coach_phases
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
```

#### Step 0.3: Add TypeScript Types
**File:** `lib/db/types.ts` (update)

```typescript
export interface CoachWorkout {
  id: string;
  user_id: string;
  workout_name: string;
  workout_name_variants?: string[];
  category?: string;
  sub_category?: string;
  training_phase?: string;
  description?: string;
  typical_distance_km?: number;
  typical_duration_min?: number;
  target_zone?: string;
  target_pace?: string;
  intensity_level?: number;
  coach_notes?: string;
  when_to_use?: string;
  when_to_avoid?: string;
  recovery_needed?: string;
  times_performed?: number;
  last_performed?: string;
  avg_feeling?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CoachPhase {
  id: string;
  user_id: string;
  phase_name: string;
  phase_order?: number;
  description?: string;
  typical_duration_weeks?: number;
  focus_areas?: string[];
  weekly_structure?: Record<string, string>;
  workout_types?: string[];
  intensity_distribution?: Record<string, number>;
  coach_notes?: string;
  key_workouts?: string[];
  avoid_in_phase?: string[];
  volume_progression?: string;
  intensity_progression?: string;
  source?: string;
  created_at?: string;
}
```

---

### Phase 1: Core Context Builder
**Priority: HIGH | Estimate: 3-4 hours**

#### Step 1.1: Create User Context Formatter
**File:** `lib/rag/user-formatter.ts`

```typescript
// Responsibilities:
// - Format recent runs into AI-readable text
// - Format feedback with fatigue indicators
// - Format athlete profile
// - Format active plan + current week
// - Calculate composite fatigue score
// - Respect token budget

interface FormattedUserContext {
  text: string;
  tokenCount: number;
  metadata: {
    runsIncluded: number;
    fatigueScore: number;
    currentPhase: string | null;
    hasActivePlan: boolean;
  };
}

export async function formatUserContext(
  userId: string,
  maxTokens: number
): Promise<FormattedUserContext>;
```

#### Step 1.2: Create Old Coach Context Retriever
**File:** `lib/rag/coach-retriever.ts`

```typescript
// Responsibilities:
// - Fetch relevant workouts from coach_workouts table
// - Match by category, phase, or workout name
// - Include coach notes and wisdom
// - Analyze patterns from historical runs
// - Respect token budget

interface FormattedCoachContext {
  text: string;
  tokenCount: number;
  workoutsIncluded: string[];
  phasesIncluded: string[];
}

export async function retrieveCoachContext(
  userId: string,
  query: string,
  filters: {
    phase?: string;
    workoutType?: string;
    category?: string;
  },
  maxTokens: number
): Promise<FormattedCoachContext>;

// Helper: Find relevant workouts based on query
export async function findRelevantWorkouts(
  userId: string,
  workoutType?: string,
  phase?: string
): Promise<CoachWorkout[]>;

// Helper: Analyze workout patterns from runs
export async function analyzeWorkoutPatterns(
  userId: string,
  workoutName: string
): Promise<{
  avgDuration: number;
  avgDistance: number;
  avgFeeling: number;
  typicalDayOfWeek: string;
  followedBy: string[];  // What workouts typically come after
}>;
```

#### Step 1.3: Create Book Context Retriever
**File:** `lib/rag/book-retriever.ts`

```typescript
// Responsibilities:
// - Generate embedding for user query
// - Search instructions with filters (phase, workout type)
// - Format results with source attribution
// - Respect token budget

interface FormattedBookContext {
  text: string;
  tokenCount: number;
  sources: {
    bookTitle: string;
    methodology: string;
    chapterTitle?: string;
  }[];
}

export async function retrieveBookContext(
  query: string,
  filters: {
    phase?: string;
    workoutType?: string;
    level?: string;
  },
  maxTokens: number
): Promise<FormattedBookContext>;
```

#### Step 1.4: Create Main Context Builder
**File:** `lib/rag/context-builder.ts`

```typescript
// Responsibilities:
// - Orchestrate all three context layers
// - Apply weighting based on query type
// - Assemble final context string
// - Track sources for attribution

interface EnhancedContext {
  userContext: FormattedUserContext;
  coachContext: FormattedCoachContext;
  bookContext: FormattedBookContext;
  combinedPrompt: string;
  totalTokens: number;
  queryType: QueryType;
}

export async function buildContext(
  userId: string,
  query: string,
  queryType: QueryType
): Promise<EnhancedContext>;
```

---

### Phase 2: Enhanced Prompts
**Priority: HIGH | Estimate: 1-2 hours**

#### Step 2.1: Update Coach System Prompts
**File:** `lib/ai/coach-prompts.ts` (update existing)

```typescript
export function buildCoachSystemPrompt(
  context: EnhancedContext
): string {
  return `
Role: You are the "Running Box AI Coach," an expert endurance specialist who knows this athlete's history and their previous coach's methods.

## Knowledge Hierarchy (Follow This Order)
1. **PRIMARY - Athlete Data**: The user's actual recent training and feedback. This is ground truth about their current state.
2. **SECONDARY - Previous Coach Patterns**: Workout definitions and wisdom from their previous coach. These are proven to work for THIS specific athlete.
3. **TERTIARY - Book Methodology**: The coaching book excerpts. Apply these general rules when they don't conflict with athlete-specific data.
4. **QUATERNARY - General Knowledge**: Your sports science knowledge. Only use when other sources don't cover the topic.

## Current Athlete State (Priority 1)
${context.userContext.text}

## Previous Coach's Methods (Priority 2)
${context.coachContext.text}

## Methodology Guidelines (Priority 3)
${context.bookContext.text}

## Instructions
- Reference the athlete's specific workouts by name when relevant (e.g., "Your coach's 'LT2 Intervals' workout...")
- When suggesting workouts, prefer ones from their previous coach's library when appropriate
- If athlete data shows fatigue but methodology says push, ASK the user how they feel today
- Use terminology consistent with both the previous coach AND the methodology books
- Never give generic internet fitness advice - stay loyal to the loaded sources
- When sources conflict, present both options and let the user decide

## Conflict Resolution
- If previous coach's method differs from book methodology: Mention both, note that the coach's method was specifically tailored for this athlete
- If user's current data conflicts with all recommendations: Prioritize current state, but note what the sources would normally recommend

## Response Format
- Be concise and actionable
- Include the "why" behind recommendations
- Cite sources: "According to your previous coach..." or "The [Book Title] recommends..."
`;
}
```

---

### Phase 3: API Integration
**Priority: HIGH | Estimate: 2-3 hours**

#### Step 3.1: Update Ask Coach API
**File:** `app/api/coach/ask/route.ts` (update existing)

```typescript
// Changes:
// - Import and use buildContext()
// - Pass queryType based on detected intent
// - Include all sources in response

export async function POST(request: Request) {
  // 1. Get user ID from session
  // 2. Parse query and detect queryType
  // 3. Build enhanced context with all three layers
  const context = await buildContext(userId, query, queryType);

  // 4. Build system prompt with context
  const systemPrompt = buildCoachSystemPrompt(context);

  // 5. Call OpenRouter API
  // 6. Return response with sources
  return Response.json({
    response: aiResponse,
    sources: {
      books: context.bookContext.sources,
      coachWorkouts: context.coachContext.workoutsIncluded,
    },
    fatigueScore: context.userContext.metadata.fatigueScore,
    queryType: queryType,
  });
}
```

---

### Phase 4: Data Import Tools
**Priority: MEDIUM | Estimate: 2-3 hours**

#### Step 4.1: TrainingPeaks Import Utility
**File:** `lib/import/trainingpeaks.ts`

```typescript
// Parse TrainingPeaks export and populate coach_workouts table

interface TrainingPeaksWorkout {
  name: string;
  description?: string;
  workoutType?: string;
  // ... other fields from TP export
}

export async function importTrainingPeaksWorkouts(
  userId: string,
  workouts: TrainingPeaksWorkout[]
): Promise<{ imported: number; skipped: number; errors: string[] }>;

// Analyze existing runs to extract workout patterns
export async function deriveWorkoutsFromRuns(
  userId: string
): Promise<CoachWorkout[]>;
```

#### Step 4.2: Admin UI for Workout Management
**File:** `app/coach/settings/workouts/page.tsx`

```typescript
// UI to:
// - View all coach workouts
// - Edit workout details
// - Import from TrainingPeaks
// - Manually add workouts
// - Analyze patterns from runs
```

---

### Phase 5: Database Enhancements
**Priority: MEDIUM | Estimate: 1 hour**

#### Step 5.1: Add Optimized Search RPC
**Migration:** `supabase/migrations/XXXXXX_add_search_functions.sql`

```sql
-- Search coach workouts by criteria
CREATE OR REPLACE FUNCTION search_coach_workouts(
  p_user_id text,
  p_category text DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_workout_name text DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS SETOF coach_workouts
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM coach_workouts
  WHERE user_id = p_user_id
    AND (p_category IS NULL OR category = p_category)
    AND (p_phase IS NULL OR training_phase = p_phase)
    AND (p_workout_name IS NULL OR
         workout_name ILIKE '%' || p_workout_name || '%' OR
         p_workout_name = ANY(workout_name_variants))
  ORDER BY times_performed DESC, updated_at DESC
  LIMIT p_limit;
END;
$$;

-- Optimized book instruction search with filters
CREATE OR REPLACE FUNCTION search_instructions_filtered(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  filter_phase text DEFAULT NULL,
  filter_workout_type text DEFAULT NULL,
  filter_level text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  book_id uuid,
  book_title text,
  methodology text,
  chapter_title text,
  section_title text,
  content text,
  key_rules text[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bi.id,
    bi.book_id,
    cb.title as book_title,
    cb.methodology,
    bi.chapter_title,
    bi.section_title,
    bi.content,
    bi.key_rules,
    1 - (bi.embedding <=> query_embedding) as similarity
  FROM book_instructions bi
  JOIN coaching_books cb ON cb.id = bi.book_id
  WHERE
    1 - (bi.embedding <=> query_embedding) > match_threshold
    AND (filter_phase IS NULL OR bi.applies_to_phase = filter_phase OR bi.applies_to_phase = 'All')
    AND (filter_workout_type IS NULL OR bi.applies_to_workout_type = filter_workout_type)
    AND (filter_level IS NULL OR cb.level = filter_level OR cb.level = 'all')
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
```

---

### Phase 6: UI Enhancements (Optional)
**Priority: LOW | Estimate: 2-3 hours**

#### Step 6.1: Show Sources in Chat
**File:** `components/coach/chat-message.tsx`

- Collapsible "Sources" section
- Show book sources + coach workout sources
- Visual distinction between source types

#### Step 6.2: Show Fatigue Indicator
**File:** `components/coach/fatigue-badge.tsx`

- Color-coded: Green (1-3), Yellow (4-6), Red (7-10)

#### Step 6.3: Workout Library Browser
**File:** `app/coach/workouts/page.tsx`

- Browse all coach workouts
- Filter by category, phase
- See usage stats
- Quick add to plan

---

## File Structure

### New Files to Create

```
lib/rag/
├── types.ts              # (update) Add QueryType, ContextWeights with 3 layers
├── embeddings.ts         # (exists) No changes needed
├── user-formatter.ts     # NEW - Format user data for AI
├── coach-retriever.ts    # NEW - Retrieve old coach context
├── book-retriever.ts     # NEW - Retrieve and format book context
├── context-builder.ts    # NEW - Main orchestration (3 layers)
└── fatigue-calculator.ts # NEW - Calculate fatigue score

lib/db/
├── types.ts              # (update) Add CoachWorkout, CoachPhase types
├── coach-workouts.ts     # NEW - CRUD for coach_workouts table
├── coach-phases.ts       # NEW - CRUD for coach_phases table
├── books.ts              # (exists) Minor updates for new RPC
└── [others]              # No changes

lib/import/
└── trainingpeaks.ts      # NEW - Import utility for TP data

lib/ai/
├── coach-prompts.ts      # (update) Add 3-layer hierarchy prompt
└── openrouter.ts         # (exists) No changes needed

app/api/coach/
├── ask/route.ts          # (update) Use 3-layer context builder
├── plan/route.ts         # (update) Use 3-layer context builder
└── grocky/route.ts       # (update) Use 3-layer context builder

app/coach/settings/
└── workouts/page.tsx     # NEW - Manage workout library

supabase/migrations/
├── XXXXXX_create_coach_workouts.sql   # NEW
├── XXXXXX_create_coach_phases.sql     # NEW
└── XXXXXX_add_search_functions.sql    # NEW
```

### Existing Files to Update

| File | Changes |
|------|---------|
| `lib/rag/types.ts` | Add 3-way `ContextWeights`, `QueryType`, `QUERY_WEIGHTS` |
| `lib/db/types.ts` | Add `CoachWorkout`, `CoachPhase` interfaces |
| `lib/ai/coach-prompts.ts` | Add `buildCoachSystemPrompt()` with 3-layer hierarchy |
| `lib/db/books.ts` | Add `searchInstructionsFiltered()` wrapper |
| `app/api/coach/ask/route.ts` | Integrate 3-layer context builder |
| `app/api/coach/plan/route.ts` | Integrate 3-layer context builder |
| `app/api/coach/grocky/route.ts` | Integrate 3-layer context builder |

---

## Database Changes

### New Tables
1. `coach_workouts` - Old coach workout definitions from TrainingPeaks
2. `coach_phases` - Old coach training phase templates

### New RPC Functions
1. `search_coach_workouts` - Search workouts by category/phase/name
2. `search_instructions_filtered` - Enhanced book search with filters

### Existing Data to Leverage
- `runs.workout_name` - 634 runs already have workout names
- `runs.coach_notes` - Some runs have coach notes
- Can derive `coach_workouts` entries from analyzing existing runs

---

## Data Flow Example

### Query: "What should I run today?"

```
1. DETECT QUERY TYPE
   → "daily_advice" (65% user / 10% coach / 25% books)

2. FETCH USER CONTEXT (65% = 5200 tokens)
   → Last 14 days of runs
   → Recent feedback (feeling, effort)
   → Weekly summary (sleep: 6/10, stress: 7/10)
   → Active plan: Week 8 of Half Marathon, "Build" phase
   → Fatigue score: 6.8/10

3. FETCH COACH CONTEXT (10% = 800 tokens)
   → Query: "What does old coach do on recovery days in Build phase?"
   → Found: "Easy Recovery" workout
     - Description: "30-40 min very easy, conversational pace"
     - Coach notes: "Never skip recovery days, they're when adaptation happens"
     - When to use: "Day after intervals or tempo"
   → Found pattern: After tempo runs, old coach typically scheduled easy day

4. FETCH BOOK CONTEXT (25% = 2000 tokens)
   → Semantic search: "recovery day build phase"
   → Found: "The Running Box - Chapter 5: Recovery"
     - "After threshold workouts, schedule 24-48h of Zone 1-2 running"
   → Found: "80/20 Running - Easy Days"
     - "80% of training should be easy, including recovery runs"

5. ASSEMBLE PROMPT
   → System prompt with hierarchy of truth
   → All three contexts formatted
   → User question

6. AI RESPONSE
   "Based on your tempo run yesterday and elevated fatigue (6.8/10),
    today should be a recovery day. Your previous coach's 'Easy Recovery'
    workout - 30-40 min at conversational pace - would be perfect.
    This aligns with the Running Box recommendation for Zone 1-2 running
    after threshold work. How are you feeling this morning?"
```

---

## Implementation Order

```
Week 1:
├── ✅ Day 1: Phase 0 (Database Setup) - COMPLETE
│   ├── ✅ Create coach_workouts table
│   ├── ✅ Create coach_phases table
│   ├── ✅ Add TypeScript types
│   └── ✅ Add search RPC functions
│
├── ✅ Day 2-3: Phase 1 (Context Builders) - COMPLETE
│   ├── ✅ user-formatter.ts
│   ├── ✅ coach-retriever.ts
│   ├── ✅ book-retriever.ts
│   └── ✅ context-builder.ts
│
├── ✅ Day 4: Phase 4 (Data Import) - COMPLETE
│   ├── ✅ import-trainingpeaks.ts script
│   ├── ✅ load-books.ts script (updated to use OpenRouter)
│   ├── ✅ TrainingPeaks import: 69 workouts loaded
│   └── ✅ Books loaded: 1,429 total chunks with embeddings
│
├── ✅ Day 5: Phase 2 (Enhanced Prompts) - COMPLETE
│   ├── ✅ buildEnhancedCoachSystemPrompt (3-layer hierarchy)
│   ├── ✅ buildEnhancedWeeklyAnalysisPrompt
│   ├── ✅ buildEnhancedPlanGenerationPrompt
│   ├── ✅ buildEnhancedPlanAdjustmentPrompt
│   ├── ✅ buildEnhancedGrockySystemPrompt
│   ├── ✅ buildEnhancedGrockyPlanReviewPrompt
│   └── ✅ buildEnhancedGrockyChatPrompt
│
├── ✅ Day 6: Phase 3 (API Integration) - COMPLETE
│   ├── ✅ Update ask/route.ts - uses 3-layer context
│   ├── ✅ Update plan/generate/route.ts - uses 3-layer context
│   └── ✅ Update grocky/route.ts - uses 3-layer context

Week 2:
└── 🔲 Phase 6 (UI - Optional)
    ├── 🔲 Sources in chat
    ├── 🔲 Fatigue badge
    └── 🔲 Workout library browser
```

---

## Data Import Instructions

### 1. Import TrainingPeaks Workouts

```bash
# Install dependencies first
npm install better-sqlite3 dotenv

# Run the import script
npx tsx scripts/import-trainingpeaks.ts "C:\Users\reutn\OneDrive\Desktop\books\tp_running_data.db" <your-user-id>
```

This will:
- Read 287 runs from your TrainingPeaks database
- Extract unique workout names and coach notes
- Categorize workouts (Recovery, Threshold, VO2max, etc.)
- Import into `coach_workouts` table

### 2. Load Coaching Books

```bash
# Load each book (run one at a time)
npx tsx scripts/load-books.ts "C:\Users\reutn\OneDrive\Desktop\books\Run Elite - Train and Think Like the Greatest Distance -  Snow, Andrew.json"

npx tsx scripts/load-books.ts "C:\Users\reutn\OneDrive\Desktop\books\80_20 running -run stronger and race faster by training slower - Fitzgerald, Matt_ Johnson, Robert.json"

npx tsx scripts/load-books.ts "C:\Users\reutn\OneDrive\Desktop\books\Run Faster from the 5K to the Marathon - Brad Hudson_ Matt Fitzgerald.json"

npx tsx scripts/load-books.ts "C:\Users\reutn\OneDrive\Desktop\books\Better Training for Distance Runners - David E. Martin, Peter N. Coe.json"

npx tsx scripts/load-books.ts "C:\Users\reutn\OneDrive\Desktop\books\Endure_ Mind, Body, and the Curiously Elastic Limits of Human Performance - Alex Hutchinson.json"
```

This will:
- Parse each book JSON file
- Chunk text into ~2000 char segments
- Generate embeddings via OpenAI
- Store in `book_instructions` table with metadata

---

## Success Criteria

1. **Three-Layer Integration**: AI uses all three sources appropriately
2. **Personalization**: AI references user's specific coach workouts by name
3. **Attribution**: Responses cite which layer informed advice
4. **Weighting**: Plan generation uses 55% books, daily advice uses 65% user data
5. **Conflict Handling**: When sources conflict, AI presents options
6. **Performance**: Context building completes in <500ms
7. **Token Efficiency**: Never exceeds 8000 token budget

---

## Testing Checklist

### Unit Tests
- [ ] Fatigue calculation with various feedback
- [ ] User formatting respects token limits
- [ ] Coach retrieval finds relevant workouts
- [ ] Book retrieval applies filters correctly
- [ ] Weight calculations sum to 1.0

### Integration Tests
- [ ] Full flow: Query → Context → Response
- [ ] Query type detection works
- [ ] Sources correctly attributed in response

### Manual Testing
- [ ] Ask "What should I run today?" - verify 65/10/25 split
- [ ] Generate new plan - verify 35/10/55 split
- [ ] Verify old coach workouts appear in suggestions
- [ ] Test with no coach workouts (should work with user + books only)
- [ ] Test with no books (should work with user + coach only)

---

## Notes & Decisions

- **TrainingPeaks as source**: Will import workout library from TP exports
- **10% for old coach**: Consistent across all query types - enough to influence but not dominate
- **Derive from runs**: Can analyze existing 634 runs to populate coach_workouts automatically
- **Conflicts case-by-case**: AI presents options when sources disagree
- **No embedding for coach workouts**: Simple text matching is sufficient for workout library

---

## Next Steps

1. Review this updated plan
2. Start with Phase 0 (Database migrations)
3. Import/derive coach workouts from existing runs
4. Build context retrievers
5. Test with real queries
