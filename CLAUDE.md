# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RunCoach + CalTrack + Portfolio** - A multi-app platform featuring an AI Running Coach with Strava integration, a calorie tracking dashboard (CalTrack), a professional CV/portfolio, and a blog with TTS. Built with Next.js 16, React 19, Bun, TypeScript, and Supabase.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, NextAuth.js, Supabase (PostgreSQL + RLS), OpenRouter (Claude/Grok/GPT-4o), Strava API, Vercel Cron, Bun runtime

**Repository:** https://github.com/iAMido/running-coach
**Deployed:** Vercel (auto-deploy from `master`)

## Development Commands

```bash
bun run dev      # Start dev server with Turbopack
bun run build    # Production build - MUST pass before every commit
bun run start    # Start production server
bun run lint     # Run ESLint
```

```bash
bun install              # Install dependencies
bun add <package>        # Add dependency
bunx shadcn@latest add <component>  # Add shadcn/ui component
```

## Architecture

### App Router Structure
- **Server Components by default** unless marked `'use client'`
- **API Routes** use `export const runtime = 'nodejs'` for external API calls
- **Vercel Cron** for scheduled Strava sync
- **One Supabase project, two schemas** (post-consolidation, May 2026): the CalTrack project (`tlnqkxwlrewbtufnqiwi`) hosts both apps. CalTrack's tables live in the `public` schema; RunCoach's tables live in the `runcoach` schema. The two `lib/db/supabase*` clients are configured with different `db.schema` settings to route queries to the right place. The old RunCoach project (`ucjsnpnlxklaadqolpkx`) is paused.

### Directory Structure
```
app/
├── page.tsx                          # CV homepage (client component, anchor nav)
├── layout.tsx                        # Root layout with providers
├── providers.tsx                     # ThemeProvider + SessionProvider
├── globals.css                       # Tailwind + RunCoach design system
├── api/
│   ├── auth/[...nextauth]/route.ts   # NextAuth (Google OAuth)
│   ├── coach/
│   │   ├── chat/ask/route.ts         # Ask Coach (Claude via OpenRouter)
│   │   ├── chat/grocky/route.ts      # Grocky Balboa (Grok second opinion)
│   │   ├── feedback/route.ts         # Run feedback CRUD (links to run_id)
│   │   ├── plans/route.ts            # Training plans CRUD
│   │   ├── plans/generate/route.ts   # AI plan generation
│   │   ├── plans/adjust/route.ts     # AI plan adjustment
│   │   ├── profile/route.ts          # Athlete profile
│   │   ├── reports/route.ts          # Coach reports list/detail
│   │   ├── review/route.ts           # Weekly review data
│   │   ├── review/analyze/route.ts   # AI weekly analysis (saves to coach_reports)
│   │   ├── runs/route.ts             # Runs data with pagination
│   │   ├── stats/route.ts            # Dashboard statistics
│   │   ├── strength/route.ts         # Strength training
│   │   └── upload/route.ts           # GPX/FIT file upload
│   ├── strava/
│   │   ├── auth/route.ts             # Strava OAuth initiation
│   │   ├── callback/route.ts         # Strava OAuth callback
│   │   ├── disconnect/route.ts       # Disconnect Strava
│   │   └── sync/route.ts             # Manual Strava sync (with laps)
│   ├── cron/
│   │   └── strava-sync/route.ts      # Automated sync (Vercel Cron, CRON_SECRET)
│   ├── caltrack/                     # CalTrack endpoints (separate Supabase)
│   │   ├── overview/route.ts         # Daily summary, weight chart
│   │   ├── meals/route.ts            # Meals list
│   │   ├── meals/add/route.ts        # Add meal
│   │   ├── meals/edit/route.ts       # Edit meal
│   │   ├── meals/delete/route.ts     # Delete meal
│   │   ├── analyze/route.ts          # AI food analysis (Hebrew support)
│   │   ├── weight/route.ts           # Weight logs
│   │   ├── foods/route.ts            # Food database
│   │   ├── foods/search/route.ts     # Food search
│   │   ├── water/route.ts            # Water tracking
│   │   ├── templates/route.ts        # Meal templates
│   │   └── coach-reports/route.ts    # CalTrack coach reports
│   └── admin/
│       └── regenerate-embeddings/route.ts  # RAG embedding regeneration
├── coach/                            # AI Running Coach (protected)
│   ├── layout.tsx                    # Protected layout with sidebar
│   ├── page.tsx                      # Dashboard (stats, recent runs, chart)
│   ├── log/page.tsx                  # Log runs + post-run feedback
│   ├── review/page.tsx              # Weekly review with AI analysis
│   ├── plan/page.tsx                 # Training plan generation
│   ├── ask/page.tsx                  # Ask Coach (Claude chat)
│   ├── grocky/page.tsx              # Grocky Balboa (Grok second opinion)
│   ├── reports/page.tsx             # Coach reports history (list + detail)
│   ├── strava/page.tsx              # Strava connection management
│   ├── strava/callback/page.tsx     # Strava OAuth callback
│   └── settings/page.tsx            # User settings
├── caltrack/                         # CalTrack calorie tracking
│   ├── layout.tsx                    # CalTrack layout with sidebar
│   ├── page.tsx                      # Overview (daily calories, macros, weight)
│   ├── meals/page.tsx               # Meals with add/edit/delete + AI analysis
│   ├── weight/page.tsx              # Weight log
│   ├── foods/page.tsx               # Food database browser
│   └── coach/page.tsx               # CalTrack coach reports
├── blog/
│   ├── page.tsx                      # Blog listing
│   └── [slug]/page.tsx              # Article (SSG with generateStaticParams)
└── profile/page.tsx                  # Protected user profile

components/
├── coach/sidebar.tsx                 # Coach sidebar navigation
├── cv/                               # CV components (anchor nav, hero, etc.)
├── blog/article-content.tsx          # Article with TTS player
├── layout/                           # Navbar, footer
└── ui/                               # shadcn/ui components

lib/
├── ai/
│   ├── openrouter.ts                 # OpenRouter API client (multi-model)
│   ├── coach-prompts.ts              # Claude coach system prompts
│   └── grocky-prompts.ts            # Grok system prompts
├── auth/
│   └── get-user.ts                   # getAuthenticatedUser() helper
├── db/
│   ├── supabase.ts                   # RunCoach Supabase client (service role)
│   ├── supabase-caltrack.ts          # CalTrack Supabase client (separate project)
│   ├── types.ts                      # RunCoach TypeScript types
│   ├── caltrack-types.ts             # CalTrack types
│   ├── runs.ts                       # Runs CRUD
│   ├── plans.ts                      # Training plans CRUD
│   ├── profile.ts                    # Athlete profile CRUD
│   ├── feedback.ts                   # Run feedback & weekly summaries
│   ├── books.ts                      # RAG book embeddings
│   ├── coach-workouts.ts             # Coach workout patterns
│   └── strength.ts                   # Strength training data
├── rag/                              # 3-layer RAG system
│   ├── book-retriever.ts             # Book methodology retrieval (merges user_resources too)
│   ├── coach-retriever.ts            # Coach patterns retrieval
│   ├── context-builder.ts            # Combines all RAG layers
│   ├── embeddings.ts                 # OpenAI embeddings generation
│   ├── chunker.ts                    # Paragraph-aware chunker for ingestion
│   ├── user-formatter.ts            # User data formatting for context
│   ├── user-resource-retriever.ts   # Per-user uploaded material retrieval
│   └── types.ts                      # RAG type definitions
├── supervisor/                       # Pre/post-flight gate around every AI call
│   ├── preflight.ts                  # Deterministic coverage rules
│   ├── critic.ts                     # Haiku response audit
│   ├── telemetry.ts                  # logCoachCall → coach_calls
│   ├── types.ts                      # Supervisor types
│   └── index.ts                      # Barrel export
├── validation/
│   └── schemas.ts                    # Zod validation schemas (feedback, etc.)
├── utils/
│   ├── pace.ts                       # Pace formatting/conversion
│   ├── run-classifier.ts            # Run type classification — honors athlete_profile zones, emits 'Intervals'
│   ├── zones.ts                     # HR zone helpers: parseZonesFromProfile, computeZonePercentsFromStream
│   ├── trimp.ts                      # Training load (TRIMP) calculation
│   ├── week-calculator.ts           # Week boundary calculations
│   └── oauth-state.ts              # Strava OAuth state management
├── hooks/
│   └── use-pwa.ts                    # PWA installation hook
├── cv-data.ts                        # CV content (single source of truth)
├── blog.ts                           # Blog data layer
└── utils.ts                          # cn() utility
```

### Supabase Tables (RunCoach project)
All tables have RLS enabled with policies for authenticated users.

| Table | Purpose |
|-------|---------|
| `runs` | Run data (from Strava sync or manual upload) |
| `laps` | Per-lap data for each run (HR, pace, distance) |
| `run_feedback` | Post-run feedback (rating, effort, notes) with `run_id` FK |
| `training_plans` | AI-generated training plans |
| `athlete_profile` | User settings (age, max HR, goals, etc.) |
| `weekly_feedback` | Weekly wellness data (sleep, stress, feeling) |
| `coach_reports` | Saved AI coach analyses (weekly reviews) |
| `strava_tokens` | Strava OAuth tokens per user |
| `book_embeddings` | RAG: running book methodology chunks |
| `coach_workouts` | RAG: coach workout pattern embeddings |
| `coach_phases` | RAG: synthesized phase wisdom (Base / Specific) |
| `user_resources` / `user_resource_chunks` | RAG: athlete-uploaded coach material (per user, pgvector) |
| `coach_calls` | Supervisor: one row per AI request (tokens, latency, warnings) |
| `coach_response_audits` | Supervisor: Haiku critic scores per response |
| `strength_exercises` | Strength training exercises |

### Key Patterns

**Authentication:** NextAuth.js with Google OAuth. API routes use `getAuthenticatedUser()` from `lib/auth/get-user.ts`.

**AI Integration:** OpenRouter API client supports multiple models (Claude Sonnet 4, Grok, GPT-4o). 3-layer RAG provides context: athlete data + coach patterns + book methodology.

**RAG context budget:** `TOKEN_BUDGETS_PER_QUERY` in `lib/rag/types.ts` sets the per-query-type budget (chat 20k, daily 24k, weekly review 32k, plan generation 48k). `QUERY_WEIGHTS` splits each budget across the three layers. Raised from the original 8k flat budget once we noticed the coach layer was capped at ~800 tokens and surfacing only 5 of 69 historical workouts.

**Prompt caching:** `callOpenRouter({ cacheSystemPrompt: true })` rewrites the first system message as a structured content array with `cache_control: ephemeral` (Anthropic only). Enabled on chat, weekly review, and plan generation. Multi-turn chat and retries hit the cache within 5 min.

**User context formatter (`lib/rag/user-formatter.ts`):**
- Joins `run_feedback` to each run by `run_id` (falls back to date) and shows rating / effort / feeling / comment / followed_plan inline. Previously fetched but never rendered.
- Serializes the current week's per-day planned workouts (type / distance / pace / HR / description) under "Active Training Plan".
- Calls `getRecentRunsWithLaps` to attach laps for quality workouts (Intervals, Tempo, Fartlek, Long Run, or any run with >15% Z4+ time).
- Uses `calculateCurrentWeek(plan.start_date, …)` rather than the stored `plan.current_week_num`, so the AI doesn't see a stale phase if the cron hasn't advanced.

**Weekly review prompt:** Renders a PLANNED vs ACTUAL block side-by-side and asks for per-rep interval commentary using the lap detail.

**User resources (`lib/rag/user-resource-retriever.ts`, `/coach/resources`):** Athlete-uploaded coach material. `POST /api/coach/resources` accepts either `application/json` (`{ title, content, ... }`) or `multipart/form-data` (PDF file via `pdf-parse`). Chunks via `lib/rag/chunker.ts`, embeds via `text-embedding-3-small`, writes to `runcoach.user_resources` + `runcoach.user_resource_chunks`. The book retriever calls `retrieveUserResources(userId, query, ...)` in parallel with its book search and merges results into the same "Methodology Guidelines" block — user resources go first so they win ties when the prompt truncates. Soft-delete via `DELETE /api/coach/resources/[id]` (sets `status='archived'`, retains embeddings).

**Supervisor UI:** The chat (`/coach/ask`) renders the supervisor envelope's warnings as a chip above each assistant bubble (`ShieldAlert` icon, warning codes inline). The dashboard (`/coach`) shows a `CoachHealthWidget` summarising the last 7 days from `/api/coach/health` — total calls, errors, avg critic score, preflight warning count, ceiling-hit count, top warning codes. Both gracefully hide when there's no data yet.

**Supervisor (`lib/supervisor/`):** Three-piece watchdog on every AI call.
- **Pre-flight (`preflight.ts`)** — deterministic `validateContext(...)` that flags silent gaps (no planned-today workout, no recent runs, no book sources for plan generation, no active plan covering the review week). May inject a "SUPERVISOR NOTES" suffix into the system prompt so the model acknowledges gaps instead of confabulating.
- **Telemetry (`telemetry.ts`)** — `logCoachCall(...)` writes one row to `runcoach.coach_calls` per AI request (route, query_type, tokens, ceiling_hit, cache_used, latency, preflight warnings, plan_modified).
- **Post-flight critic (`critic.ts`)** — fire-and-forget call to `anthropic/claude-haiku-4-5` that grades the response on 5 axes (addresses_question / references_plan_day / references_runs_feedback / specific_pace_hr / no_contradiction), persists to `runcoach.coach_response_audits`. Auto-back-links the audit_id onto the coach_calls row.
- **Weekly health audit (`/api/cron/weekly-health-audit`)** — Sunday 22:30 UTC Vercel cron. Reads coverage / plan drift / RAG embedding completeness / AI quality stats from `coach_calls` + `coach_response_audits` and writes a markdown report into `coach_reports` with `report_type='system_health'`.

Wired into `chat/ask`, `review/analyze`, `plans/generate`. Each route returns a `supervisor: { callId, preflightOk, warnings }` envelope so the UI can surface the warnings inline.

**Strava Sync:** OAuth flow → token storage → manual sync button + automated Vercel Cron (daily at 15:00 and 21:40 UTC). For each new activity: stores summary row, fetches `/activities/{id}/laps` for lap rows, fetches `/activities/{id}/streams?keys=heartrate,time` and buckets the HR stream into the athlete's zones (`pct_z1..pct_z6` via `lib/utils/zones.ts`). Run type classified via `classifyRun` with `workoutName` + `profile` + `zonePercents`. Token refresh on expiry, auto-disconnect on permanent auth failure.

**Input Validation:** Zod schemas in `lib/validation/schemas.ts`. All API routes validate and bound numeric inputs.

**Security:** CSP headers in `next.config.ts`, RLS on all tables, service role key for API routes, `CRON_SECRET` for cron endpoints.

**RunCoach Design System:** Custom CSS variables (`--rc-ink`, `--rc-blue`, `--rc-surface`, etc.) in `globals.css`. Dark cards with radial gradients for AI content. Editorial typography with serif italics.

## Environment Variables

```bash
# Auth
NEXTAUTH_SECRET=<generated>
NEXTAUTH_URL=https://your-domain.com
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>

# RunCoach Supabase
NEXT_PUBLIC_SUPABASE_URL=https://tlnqkxwlrewbtufnqiwi.supabase.co   # same project as CalTrack; RunCoach client uses `runcoach` schema
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# CalTrack Supabase (separate project)
NEXT_PUBLIC_CALTRACK_SUPABASE_URL=https://tlnqkxwlrewbtufnqiwi.supabase.co
CALTRACK_SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# AI
OPENROUTER_API_KEY=<openrouter-key>
OPENAI_API_KEY=<for-embeddings>

# Strava
STRAVA_CLIENT_ID=<strava-app-id>
STRAVA_CLIENT_SECRET=<strava-app-secret>

# Cron
CRON_SECRET=<random-secret-for-vercel-cron>
```

## Vercel Cron Jobs

Defined in `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/strava-sync", "schedule": "0 15 * * *" },
    { "path": "/api/cron/strava-sync", "schedule": "40 21 * * *" }
  ]
}
```

## Common Tasks

### Adding API Routes
1. Create `app/api/<path>/route.ts`
2. Add `export const runtime = 'nodejs'` at top for external API calls
3. Use `getAuthenticatedUser()` for auth
4. Validate input with Zod schemas from `lib/validation/schemas.ts`

### Updating CV Content
Edit `lib/cv-data.ts` - single source of truth for all CV sections.

### Modifying AI Coach Behavior
- System prompts: `lib/ai/coach-prompts.ts` and `lib/ai/grocky-prompts.ts`
- RAG context: `lib/rag/context-builder.ts` assembles the 3-layer context
- Token budgets per query type: `TOKEN_BUDGETS_PER_QUERY` in `lib/rag/types.ts`
- Prompt caching: pass `cacheSystemPrompt: true` to `callOpenRouter`
- Model selection: `lib/ai/openrouter.ts` (change model IDs there)

### Backfilling embeddings (one-shot admin)
The Supabase Edge Function `supabase/functions/backfill-embeddings` finds any `book_instructions` rows where `embedding IS NULL`, embeds via OpenAI `text-embedding-3-small` (1536d), and writes back. Requires the `OPENAI_API_KEY` Supabase secret. Invoke via POST with the anon key in `Authorization: Bearer`. Append `?dryRun=1` to count without writing.

### Working with Supabase
- RunCoach client: `lib/db/supabase.ts` (uses service role, bypasses RLS)
- CalTrack client: `lib/db/supabase-caltrack.ts` (separate project)
- Never use anon key in server-side code; service role is correct for API routes

## Important Notes

- **One Supabase project, two schemas** - `public` for CalTrack, `runcoach` for RunCoach. Don't mix clients: use `lib/db/supabase.ts` for RunCoach data, `lib/db/supabase-caltrack.ts` for CalTrack data.
- **`bun run build` before every commit** - TypeScript errors must be fixed.
- **Service role key fallback** - `lib/db/supabase.ts` falls back to anon key at build time (env vars unavailable during static analysis). This is intentional.
- **react-markdown** - Used for rendering AI coach analysis output (weekly review, reports).
- **Run feedback tracks by `run_id`** - Not by date. Multiple runs on same day are independent.
- **Coach reports auto-save** - Weekly analysis saves to `coach_reports` table via upsert on `(user_id, week_start)`.
