# RAG System Implementation Plan
## AI Running Coach - Hybrid Retrieval System

**Created:** 2026-01-25
**Status:** Planning
**Goal:** Implement a hybrid retrieval system combining user training data (dynamic) with coaching methodology books (static) using configurable weighting.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Weighting Configuration](#weighting-configuration)
3. [Implementation Steps](#implementation-steps)
4. [File Structure](#file-structure)
5. [Database Changes](#database-changes)
6. [API Endpoints](#api-endpoints)
7. [Testing Plan](#testing-plan)

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
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐    │
│  │   USER CONTEXT (Dynamic)    │    │   BOOK CONTEXT (Static)     │    │
│  │   Weight: 65-70%            │    │   Weight: 30-35%            │    │
│  │                             │    │                             │    │
│  │  • Recent runs (14 days)    │    │  • Semantic search results  │    │
│  │  • Run feedback (feelings)  │    │  • Filtered by:             │    │
│  │  • Weekly summary           │    │    - Current phase          │    │
│  │  • Active training plan     │    │    - Workout type           │    │
│  │  • Athlete profile          │    │    - User level             │    │
│  │  • Calculated fatigue score │    │  • Source attribution       │    │
│  └─────────────────────────────┘    └─────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    HIERARCHY OF TRUTH                            │   │
│  │  Priority 1: User's actual data (what happened)                  │   │
│  │  Priority 2: Book methodology (rules to follow)                  │   │
│  │  Priority 3: AI general knowledge (fallback only)                │   │
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
│  CONTEXT: [User data formatted] + [Book excerpts with sources]         │
│  USER: [Original question]                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CLAUDE / GROK RESPONSE                             │
│                                                                         │
│  "Based on your 20km long run yesterday and the Running Box            │
│   methodology which recommends recovery after efforts >15km,           │
│   today should be a 30-minute Zone 2 flush run..."                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Weighting Configuration

### Token Budget: 8000 tokens total for context

| Query Type | User Data | Book Data | Use Case |
|------------|-----------|-----------|----------|
| `daily_advice` | 70% (5600) | 30% (2400) | "What should I do today?" |
| `plan_review` | 70% (5600) | 30% (2400) | "How was my week?" |
| `plan_generation` | 40% (3200) | 60% (4800) | "Create a 12-week marathon plan" |
| `ask_coach` | 65% (5200) | 35% (2800) | General Q&A (default) |
| `grocky` | 65% (5200) | 35% (2800) | Second opinion |

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
  userDataWeight: number;  // 0.0 - 1.0
  bookWeight: number;      // 0.0 - 1.0 (must sum to 1.0)
}

export const QUERY_WEIGHTS: Record<QueryType, ContextWeights> = {
  daily_advice:    { userDataWeight: 0.70, bookWeight: 0.30 },
  plan_review:     { userDataWeight: 0.70, bookWeight: 0.30 },
  plan_generation: { userDataWeight: 0.40, bookWeight: 0.60 },
  ask_coach:       { userDataWeight: 0.65, bookWeight: 0.35 },
  grocky:          { userDataWeight: 0.65, bookWeight: 0.35 },
};

export const TOTAL_CONTEXT_TOKENS = 8000;
```

---

## Implementation Steps

### Phase 1: Core Context Builder
**Priority: HIGH | Estimate: 2-3 hours**

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

**Key Functions:**
- `formatRunsForAI(runs: Run[], feedback: RunFeedback[]): string`
- `formatProfileForAI(profile: AthleteProfile): string`
- `formatPlanForAI(plan: TrainingPlan): string`
- `calculateFatigueScore(feedback: RunFeedback[], summary: WeeklySummary | null): number`

#### Step 1.2: Create Book Context Retriever
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

#### Step 1.3: Create Main Context Builder
**File:** `lib/rag/context-builder.ts`

```typescript
// Responsibilities:
// - Orchestrate user + book context retrieval
// - Apply weighting based on query type
// - Assemble final context string
// - Track sources for attribution

interface EnhancedContext {
  userContext: FormattedUserContext;
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

Add new prompt template that includes:
- Hierarchy of truth instructions
- Source attribution requirements
- Conflict resolution guidance
- Methodology loyalty clause

```typescript
export function buildCoachSystemPrompt(
  context: EnhancedContext
): string {
  return `
Role: You are the "Running Box AI Coach," an expert endurance specialist.

## Knowledge Hierarchy (Follow This Order)
1. **PRIMARY - Athlete Data**: The user's actual training history and feedback below. This is ground truth.
2. **SECONDARY - Methodology**: The coaching book excerpts below. Apply these rules unless they conflict with athlete data.
3. **TERTIARY - General Knowledge**: Your sports science knowledge. Only use when books don't cover the topic.

## Athlete Context (Priority 1)
${context.userContext.text}

## Methodology Context (Priority 2)
${context.bookContext.text}

## Instructions
- When giving advice, cite which source informed your recommendation
- If athlete data shows fatigue/injury but methodology says push, ASK the user how they feel today
- Use terminology from the methodology books (e.g., "Zone 2 flush", "Lactate Threshold 1")
- Never give generic internet fitness advice - stay loyal to the loaded methodology
- If books conflict with each other, mention both approaches and let user decide

## Response Format
- Be concise and actionable
- Include the "why" behind recommendations
- When citing books, use format: "According to [Book Title]..."
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
// - Include sources in response

export async function POST(request: Request) {
  // 1. Get user ID from session
  // 2. Parse query and detect queryType
  // 3. Build enhanced context
  const context = await buildContext(userId, query, queryType);

  // 4. Build system prompt with context
  const systemPrompt = buildCoachSystemPrompt(context);

  // 5. Call OpenRouter API
  // 6. Return response with sources
  return Response.json({
    response: aiResponse,
    sources: context.bookContext.sources,
    fatigueScore: context.userContext.metadata.fatigueScore,
  });
}
```

#### Step 3.2: Update Plan Generation API
**File:** `app/api/coach/plan/route.ts` (update existing)

```typescript
// Changes:
// - Use queryType = 'plan_generation' (60% books, 40% user)
// - Search for relevant schedule templates
// - Include template sources in response
```

#### Step 3.3: Update Grocky API
**File:** `app/api/coach/grocky/route.ts` (update existing)

```typescript
// Changes:
// - Use same context builder
// - Different system prompt for Grok personality
```

---

### Phase 4: Database Enhancements
**Priority: MEDIUM | Estimate: 1 hour**

#### Step 4.1: Add Optimized Search RPC
**Migration:** `supabase/migrations/XXXXXX_add_hybrid_search_rpc.sql`

```sql
-- Optimized RPC for combined instruction search with filters
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

### Phase 5: UI Enhancements (Optional)
**Priority: LOW | Estimate: 1-2 hours**

#### Step 5.1: Show Sources in Chat
**File:** `components/coach/chat-message.tsx`

```typescript
// Add collapsible "Sources" section to AI responses
// Show book title, methodology, and relevant excerpt
```

#### Step 5.2: Show Fatigue Indicator
**File:** `components/coach/fatigue-badge.tsx`

```typescript
// Visual indicator of calculated fatigue score
// Color-coded: Green (1-3), Yellow (4-6), Red (7-10)
```

---

## File Structure

### New Files to Create

```
lib/rag/
├── types.ts              # (update) Add QueryType, ContextWeights
├── embeddings.ts         # (exists) No changes needed
├── user-formatter.ts     # NEW - Format user data for AI
├── book-retriever.ts     # NEW - Retrieve and format book context
├── context-builder.ts    # NEW - Main orchestration
└── fatigue-calculator.ts # NEW - Calculate fatigue score

lib/ai/
├── coach-prompts.ts      # (update) Add enhanced prompts
└── openrouter.ts         # (exists) No changes needed

lib/db/
├── books.ts              # (exists) Minor updates for new RPC
└── [others]              # No changes

app/api/coach/
├── ask/route.ts          # (update) Use context builder
├── plan/route.ts         # (update) Use context builder
└── grocky/route.ts       # (update) Use context builder

supabase/migrations/
└── XXXXXX_add_hybrid_search_rpc.sql  # NEW - Optimized search
```

### Existing Files to Update

| File | Changes |
|------|---------|
| `lib/rag/types.ts` | Add `QueryType`, `ContextWeights`, `QUERY_WEIGHTS` |
| `lib/ai/coach-prompts.ts` | Add `buildCoachSystemPrompt()` with hierarchy |
| `lib/db/books.ts` | Add `searchInstructionsFiltered()` wrapper |
| `app/api/coach/ask/route.ts` | Integrate context builder |
| `app/api/coach/plan/route.ts` | Integrate context builder |
| `app/api/coach/grocky/route.ts` | Integrate context builder |

---

## Database Changes

### New RPC Function
- `search_instructions_filtered` - Enhanced search with level/phase/workout filters

### No Schema Changes Required
- All needed fields already exist in current tables
- `coach_notes` field exists in `runs` table
- `feeling`, `effort_level` exist in `run_feedback` table
- `sleep_quality`, `stress_level` exist in `weekly_summaries` table

---

## API Endpoints

### Updated Endpoints

#### POST `/api/coach/ask`
**Request:**
```json
{
  "message": "What should I run today?",
  "history": [...],
  "queryType": "daily_advice"  // Optional, auto-detected if not provided
}
```

**Response:**
```json
{
  "response": "Based on your 20km long run yesterday...",
  "sources": [
    {
      "bookTitle": "The Running Box",
      "methodology": "Triphasic",
      "chapterTitle": "Recovery Principles"
    }
  ],
  "fatigueScore": 7.2,
  "queryType": "daily_advice"
}
```

#### POST `/api/coach/plan`
**Request:**
```json
{
  "planType": "Half Marathon",
  "durationWeeks": 12,
  "level": "intermediate"
}
```

**Response:**
```json
{
  "plan": {...},
  "sources": [
    {
      "bookTitle": "Advanced Marathon Training",
      "methodology": "Daniels",
      "planName": "12-Week Half Marathon"
    }
  ]
}
```

---

## Testing Plan

### Unit Tests

| Test | File | Description |
|------|------|-------------|
| Fatigue calculation | `__tests__/fatigue-calculator.test.ts` | Various feedback scenarios |
| User formatting | `__tests__/user-formatter.test.ts` | Token limits respected |
| Book retrieval | `__tests__/book-retriever.test.ts` | Filters work correctly |
| Context building | `__tests__/context-builder.test.ts` | Weights applied correctly |

### Integration Tests

| Test | Description |
|------|-------------|
| Ask Coach flow | Query -> Context -> Response with sources |
| Plan generation | User profile + books = personalized plan |
| Weight switching | Different queryTypes use different weights |

### Manual Testing Checklist

- [ ] Ask "What should I run today?" - verify uses 70/30 weight
- [ ] Generate new plan - verify uses 40/60 weight
- [ ] Check sources appear in response
- [ ] Verify fatigue score reflects recent feedback
- [ ] Test with no books loaded (should still work with user data only)
- [ ] Test with no user data (new user, should still work with books only)

---

## Implementation Order

```
Week 1:
├── Day 1-2: Phase 1 (Context Builder core)
│   ├── user-formatter.ts
│   ├── book-retriever.ts
│   └── context-builder.ts
│
├── Day 3: Phase 2 (Enhanced Prompts)
│   └── Update coach-prompts.ts
│
└── Day 4-5: Phase 3 (API Integration)
    ├── Update ask/route.ts
    ├── Update plan/route.ts
    └── Update grocky/route.ts

Week 2 (if needed):
├── Phase 4: Database migration
└── Phase 5: UI enhancements (optional)
```

---

## Success Criteria

1. **Personalization**: AI references specific runs from user's history
2. **Attribution**: Responses cite which book/methodology informed advice
3. **Weighting**: Plan generation clearly uses more book content than daily advice
4. **Conflict Handling**: When user data conflicts with books, AI asks for clarification
5. **Performance**: Context building completes in <500ms
6. **Token Efficiency**: Never exceeds 8000 token budget

---

## Notes & Decisions

- **No separate Vector DB needed** - Supabase pgvector handles both relational + vector
- **No source_methodology on runs** - Keep runs simple, methodology comes from books
- **Conflicts resolved case-by-case** - AI will ask user when unclear, not auto-decide
- **Configurable weights per query type** - Easy to tune without code changes

---

## Next Steps

1. Review this plan
2. Start with Phase 1, Step 1.1 (user-formatter.ts)
3. Test each component before moving to next
4. Commit after each phase completion
