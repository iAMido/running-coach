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
| `coach_chat_sessions` / `coach_chat_messages` | Persisted chat history (Ask Coach) |
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

**Prompt caching (post-restructure):** `COACH_STATIC_BLOCK` (persona + coaching rules, byte-stable, NO interpolation) travels as `cacheableSystemPrefix` in `callOpenRouter`/`streamOpenRouter` and carries the Anthropic `cache_control` breakpoint; `buildCoachDynamicBlock(context)` (RAG context + task line) is the uncached system message. Never interpolate anything per-request into the static block or the cache stops hitting. `buildEnhancedCoachSystemPrompt` still exists as static+dynamic concat for non-caching callers (grocky, plan-adjust).

**Request-scoped preloads:** `buildContext(userId, query, queryType, { plan, profile })` and `formatUserContext(userId, maxTokens, { plan, profile })` accept already-fetched rows (`null` = checked-and-absent, `undefined` = fetch internally). Routes fetch the active plan / profile once and thread them down — previously the plan was queried up to 3× per request. The Haiku query classifier only runs for `ask_coach`/`grocky` (user-authored text); fixed-string query types skip it.

**Post-response work:** telemetry (`logCoachCall`), the Haiku critic, and chat message persistence run inside `next/server after()` — off the critical path and platform-guaranteed (un-awaited promises are not). Response `supervisor.callId` is therefore always `null`; the callId lives on the persisted rows.

**Timezone rule:** server-side day/week boundary math MUST use `lib/utils/user-time.ts` (`nowInUserTz` / `dateInUserTz` / `userDateStr`, Asia/Jerusalem) — Vercel runs UTC and bare `new Date()` puts Sunday 00:00-03:00 IL into the previous training week. Client components may use `new Date()` (browser is already in the user's tz).

**Morning-after coach note:** both Strava sync paths (manual + cron) call `generateRunReaction` (`lib/ai/run-reaction.ts`, Haiku) after importing a run — a two-sentence coach reaction judged against the plan's workout for that date (`plannedWorkoutForRunDate`), stored in `runs.coach_notes`. Dashboard shows it for 36h. Always best-effort; never fails the sync.

**Readiness verdict:** `/api/coach/stats` returns `readiness: { verdict: GO|EASY|REST, reasons, fatigueScore }` computed by `lib/utils/readiness.ts` (pure function — fatigue score + yesterday's zone distribution + today's planned workout). Dashboard hero renders it as a colored badge. No LLM involved; the chat coach reads the same signals so app and coach stay consistent.

**Stats aggregates:** lifetime totals come from the `runcoach.run_totals(p_user_id)` RPC (count + sum in one call) — do not reintroduce the select-all-rows-and-reduce pattern.

**⚠️ HR-zone cutover — 2026-08-05 (documented discontinuity, do NOT "fix"):** `athlete_profile` moved from max HR 185 to **191**, bands rescaled `0-124 / 124-143 / 143-155 / 155-168 / 168-181 / 181-191`. The ~660 runs recorded before this date keep their **old-zone** `pct_z1..pct_z6`; runs synced after it use the new bands. This is deliberate — a historical recompute was explicitly rejected. Any analysis comparing zone distribution across 2026-08-05 is comparing two different definitions of "Z4", so treat the series as having a documented break there rather than backfilling it.

`lactate_threshold_hr` stays **165** while intervals.icu holds **173**. The app's zones are %-of-max anchored so threshold does not feed them, but the divergence matters for intervals.icu write-back, where `Z4 HR` resolves against *their* threshold-anchored bands. The choice of %-of-max over threshold-anchoring was made against measured Z4+ distributions (a threshold model silently disabled `readiness.ts` rule 3) — see `docs/intervals-icu-implementation-spec.md` Phase 2b before revisiting.

**Ingestion (`lib/ingest/`):** `upsertRun` is the single owner of per-activity mapping for every provider — zones, classification, TRIMP, pace, laps, coach note. Providers only produce a `NormalizedRun`; `lib/ingest/strava.ts` and `lib/ingest/intervals.ts` are the mappers. Matching is exact `filename`, else same user within 4h and 2% distance, else insert. The window must exceed 3h: a row storing Israel local time sits exactly 3h from truth in summer, so `<= 3h` has zero margin for the very corruption it exists to catch. Distance ±2% does the real discriminating — verified there are no same-distance doubles within 4h anywhere in the history. Updates are **fill-null-only** and always preserve the row `id` (`run_feedback.run_id` and `laps.run_id` are both ON DELETE CASCADE). Laps, HR streams and the active plan are passed as thunks so they are fetched only on the paths that need them. The patch decision lives in the pure `buildEnrichPatch`, so the rules are testable without a database.

**The one exception to fill-null-only:** on a **fuzzy** match, when `ctx.identityIsAuthoritative` is set, `date` and `filename` are overwritten. A fuzzy match is itself proof the stored row disagrees with the incoming one. This exists because ~50 `strava_sync` rows (2025-12-15 → 2026-06-29) store Israel local time in a timestamptz column; fill-null-only can never repair that since `date` is never null, and a 2-3h late timestamp puts a 22:30 run into the next training day and week. `filename` is included so those rows converge to the `icu_` id instead of being re-fuzzy-matched forever. Set it **only** for intervals.icu (timestamps come from the Garmin FIT file) — if Strava did it too the two providers would rewrite each other's identity on alternating syncs and never converge.

**Cron debugging notes (learned the hard way, 2026-08-06):**
- **Hobby runtime logs retain roughly 1 hour.** `vercel logs <deployment>` showing no invocation of a path proves nothing about what happened earlier in the day — absence of evidence only. Use the dashboard's Settings → Cron Jobs tab, which lists what is actually registered and has a per-job **Run** button plus **View Logs**.
- **Hobby crons have a 1-hour flexible window.** A `0 15 * * *` job fires somewhere in 15:00–16:00 UTC, so a job "missing" its minute is normal.
- **Changing an env var does not affect running deployments.** Values are baked in at build time, so `CRON_SECRET` (or any other) needs a redeploy before the deployed function sees it. In the gap, Vercel Cron sends the *new* secret while the function checks the *old* one, and every cron 401s.
- Three cron entries are registered fine on this project (2× intervals-sync + weekly-health-audit); an earlier claim here that Hobby caps at 2 was wrong.

**`laps` holds two populations, and they DO align — but verify, don't assume.** Strava-era rows (483) look like per-kilometre autosplits and intervals.icu rows look like detected work/recovery blocks, which suggests they are independent segmentations that must never be index-matched. They are not independent: both derive from the same Garmin FIT lap records, one source read by two consumers. Measured, aligned runs agree on per-lap distance to within 5–30 m. When intervals.icu's auto-detection merges or adds a segment, the lap *count* changes, which is what makes an equal-length check a working proxy.

But it is only a proxy. `scripts/backfill-lap-fields.ts` verifies the property directly — every lap must match on `distance_km` within 50 m before anything is written by `lap_number`. That is not academic: it rejected 2026-06-16 at 84 m drift, a run the count check would have accepted and written wrongly.

**Aerobic decoupling is GRADE-ADJUSTED — do not compare it to a TrainingPeaks number.** `runs.decoupling_pct` is computed in `lib/utils/decoupling.ts` from per-lap `gap_pace_min_km`, not raw speed, and `decoupling_method` records that (`lap_gap`). Raw Pa:HR is confounded by terrain: this athlete's quality sessions all climb out and descend back, so raw speed rises for free in the back half and *understates* decoupling; his steady runs lean the other way (Easy −14.6 s/km, Long Run −16.2 s/km of uphill adjustment). Gates: ≥6 laps carrying both pace and HR, laps outside **3–12 min/km** discarded, refusal when >10% of session duration is discarded, halves within 40–60% of total time, and `Intervals`/`Fartlek` excluded entirely since work/recovery structure swamps the signal.

The pace band is load-bearing, not tidiness. Without it, laps at 88.9 / 36 / 29 min/km — standing still, stairs, walking — were averaged in as "slow running". Six of 68 runs contained them and averaged **21.0%** against **6.0%** for everything else, occupying the whole top of the distribution; a stair workout ranked as the athlete's worst aerobic session. Duration-weighted HR does not protect against this: a 59-second lap at 88.9 min/km contributes real time and almost no distance, which is what collapses the second half's efficiency factor. No raw-speed fallback — a second, non-comparable measurement in the same column is how a metric quietly becomes meaningless.

**Friel's <5 / 5–8 / >8 bands are NOT applied as verdicts.** They are defined on raw Pa:HR and calibrated on other athletes. Measured on this athlete's own 66 runs: median 6.5%, and 25 runs exceed 8% — so applying them unchanged would label a third of his easy and long running "went too hard". That may be true (rebuilding at CTL 17.7 through an Israeli August, thermal drift raises Pa:HR exactly this way) or the threshold may not be his; there is not yet enough history to tell. The formatter therefore renders his own **percentile and median**, not a colour. Revisit once a season of data exists.

**⚠️ GAP + cadence changeover — 2026-08-06 (third documented discontinuity).** `runs`/`laps` gained `gap_pace_min_km` and `cadence_spm`. Every `coach_reports` row written *before* this date judged pace with no grade adjustment, so its pace commentary can be wrong in a specific, knowable direction: on net-descending terrain raw pace overstates the work by 36–48 s/km. The 2026-08-03 "Threshold Intervals" session reads 6:17/km raw but 7:05/km grade-adjusted — easy-run effort, which is why HR never passed 166. Do not treat older reports as contradicting newer ones; they were computed from strictly less information.

Two unit conventions that are load-bearing. `gap_pace_min_km` is **min/km**, matching `avg_pace_min_km` beside it, though the API returns `gap` as m/s — converted once at ingest so the two columns subtract directly. `cadence_spm` is **steps per minute (both feet)**; intervals.icu reports `average_cadence` as one-leg rpm (observed 56.2–83.6), doubled once at ingest via `toCadenceSpm`, which guards on `<120` so a source that ever reports true spm is not doubled again. Do not double it a second time anywhere downstream.

**⚠️ `runs.data_source` is not provenance for enriched fields.** After the 2026-08-06 intervals.icu backfill, 98 pre-existing rows were enriched in place (laps, zones, corrected timestamps, `icu_` filename) while `data_source` still reads `garmin` / `garmin+tp` / `strava_sync` — fill-null-only never overwrites a non-null column. Only the 19 rows *inserted* by that backfill say `intervals_sync`. So the column records **who created the row**, not where its current contents came from. `filename LIKE 'icu\_%'` (117 rows) is the reliable indicator of intervals.icu involvement. This reads like a bug and is not one; do not "fix" it by rewriting `data_source`, which would destroy the original-provenance record.

**Strava is disarmed, not removed (2026-08-06).** `runcoach.strava_tokens` was emptied (row preserved in `runcoach._bak_20260806_strava_tokens`, refresh token intact). Reason: `master` still schedules `/api/cron/strava-sync`, whose old code matches on `filename = strava_{id}` — but all 117 of those rows now read `icu_...`, so it would find nothing and INSERT up to 117 duplicates. The cron loops over `strava_tokens`, so zero rows makes it a structural no-op. Once this branch merges, `vercel.json` no longer schedules it and the token row can be restored if Strava is ever wanted again. All Strava code and the `/coach/strava` page remain in place.

**intervals.icu credentials:** `runcoach.intervals_tokens.api_key` holds an AES-256-GCM blob, never plaintext — the key grants *write* access to the athlete's calendar and the service role bypasses RLS, so RLS is not what protects it. Encrypt/decrypt via `lib/intervals/crypto.ts`; the secret lives in `INTERVALS_TOKEN_KEY` (32 bytes, base64 or hex), outside the database.

**Chat history persistence:** `/coach/ask` posts `sessionId` along with messages. `/api/coach/chat/ask` resolves or creates a `runcoach.coach_chat_sessions` row (title seeded from the first user message) and persists each user + assistant turn into `runcoach.coach_chat_messages` with the supervisor envelope snapshot. The page has a History dropdown listing past sessions; click loads a session via `GET /api/coach/chat/sessions/[id]`. Soft-archive via `DELETE` (sets `status='archived'`).

**Streaming plan generation:** `/api/coach/plans/generate/stream` is an SSE variant of plan-gen. It emits `meta`, `token` (many), and `done` events. The page consumes the stream, shows a live preview window, and sets the final plan from the `done` payload. Final JSON parse + DB write + supervisor logging + Haiku critic all happen server-side after the stream completes.

**Tag-aware user-resource retrieval:** `runcoach.match_user_resources(...)` takes an optional `match_tags text[]` parameter; when supplied, only resources whose `methodology_tags` overlap with the query tags are returned (with a no-tag-filter fallback if zero match). `context-builder.ts` derives tags from query + current phase + workout type and threads them through `book-retriever.ts` → `user-resource-retriever.ts`.

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

# intervals.icu (https://intervals.icu/settings -> Developer Settings)
INTERVALS_API_KEY=<intervals-api-key>
INTERVALS_ATHLETE_ID=<i-prefixed-athlete-id>
# Encrypts intervals_tokens.api_key at rest. 32 bytes: openssl rand -base64 32
INTERVALS_TOKEN_KEY=<32-byte-base64-or-hex-key>

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
