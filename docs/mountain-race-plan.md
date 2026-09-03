# Mountain race capability + handoff reference

**Written 2026-09-03.** Race: 21K trail race, **1,300 m gain**, **2027-07-03** — 43.3 weeks out today.
Athlete is in central Israel, currently running an **external** training plan (not app-generated); the app's own Half Marathon plan (started 2026-06-13) should be deactivated so it stops being graded against — see Part B, Chunk 0.

This doc is written for a **fresh Claude Code session with no memory of prior conversation**. Part A is everything it needs to orient before touching code. Part B is the actual work, chunked, in dependency order, with the "is this already built" question answered for every item so the next session doesn't re-discover what this one already found.

---

## Part A — Handoff reference

### Repo & environment

| | |
|---|---|
| GitHub | https://github.com/iAMido/running-coach |
| Default/deploy branch | `master` — Vercel auto-deploys from it |
| Main local checkout | `C:/Users/ido/running-coach` |
| **Note (2026-09-03):** | that checkout is currently on branch `claude/runcoach-rls-initplan` (another session's work), NOT `master` — check before assuming it mirrors production |
| This plan was written from | worktree `C:/Users/ido/running-coach/.claude/worktrees/strava-intervals-icu-migration-d15324`, branch `claude/strava-intervals-icu-migration-d15324`, HEAD `9b20f4c` |
| `origin/master` HEAD | `9b20f4c` (same commit — that branch is fully merged) |
| Runtime | Bun 1.3.5, Next.js 16 App Router, React 19, TypeScript 5 |
| Deployed URL | Vercel, auto-deploy from `master` — confirm exact domain in the Vercel dashboard; not recorded here to avoid guessing |
| Build gate | **`bun run build` must pass before every commit.** Fix all TypeScript errors first. |
| Test runner | `bun test` (added 2026-08-08; see `lib/utils/scorecard.test.ts` for the pattern — pure functions get unit tests) |

**Workflow convention this project has used throughout:** work in a git worktree, commit there, `git push origin <branch>` and `git push origin HEAD:master`, then fast-forward the main checkout with `git merge --ff-only origin/master`. Never force-push. Never amend a pushed commit — new commits only.

### Database — Supabase, one project, two schemas

```
Project ref:  tlnqkxwlrewbtufnqiwi
URL:          https://tlnqkxwlrewbtufnqiwi.supabase.co
Schemas:      public = CalTrack (a different app, same project) — do not touch
              runcoach = this app — everything below lives here
```

Old RunCoach project `ucjsnpnlxklaadqolpkx` is **paused** — if a Supabase MCP tool defaults to it, override with the ref above explicitly.

Supabase MCP tools (`mcp__f9ae2d57...` / `mcp__supabase__*`, names vary by session) take `project_id: "tlnqkxwlrewbtufnqiwi"` — pass it every time.

**Client files:** `lib/db/supabase.ts` (RunCoach, `runcoach` schema, service role — bypasses RLS) and `lib/db/supabase-caltrack.ts` (CalTrack, separate client). Never mix them.

**Row counts as of 2026-09-03** (query `select count(*) from runcoach.<table>` to refresh — these move daily via sync-on-open and the crons):

| table | rows | notes |
|---|---|---|
| `runs` | 692 | 127 with `gap_pace_min_km`, 128 with valid zones, 73 with `decoupling_pct`, 129 with `cadence_spm` |
| `laps` | 1,480 | 1,249 with GAP, 1,250 with cadence |
| `daily_wellness` | 394 | 350 HRV, 368 sleep, 394 with ctl/atl, 388 resting HR |
| `run_feedback` | 27 | |
| `coach_reports` | 18 | |
| `coach_calls` | 24 | supervisor telemetry |
| `coach_workouts` | 69 | previous coach's workout library, RAG priority-2 source |
| `coaching_books` | 7 | **all road/track** — see Chunk 3, this is the gap |
| `user_resources` | 0 | empty — nothing uploaded yet |
| `training_plans` | 8 | 1 active (the Half Marathon plan — see Chunk 0) |
| `intervals_tokens` | 1 | connected |
| `strava_tokens` | 0 | **disarmed on purpose**, see below |

**Book table names — corrected from an earlier wrong guess in this project's own history:** they are `coaching_books` and `book_instructions`, NOT `book_embeddings`. `CLAUDE.md`'s directory listing has this wrong too (says `book_embeddings`) — worth fixing in passing if you're in that file.

### Provider status — intervals.icu is the only live one

**Strava is fully wired in code but deliberately disarmed.** `strava_tokens` is empty by design (backed up in `runcoach._bak_20260806_strava_tokens`). `vercel.json` no longer schedules `/api/cron/strava-sync`. All Strava code and `/coach/strava` remain in the repo, reachable, functionally inert. **Do not build anything new against Strava — it is not the data source.**

**intervals.icu is the live path**, Garmin-sourced. Auth is HTTP Basic with the literal username `API_KEY` (not the athlete id) and the key as password; mandatory custom `User-Agent` or Cloudflare 403s; athlete id `"0"` means "the authenticated athlete." All three verified live, documented at the top of `lib/intervals/client.ts`.

```
lib/intervals/client.ts       — IntervalsClient: getActivities, getActivityIntervals (laps),
                                 getHrStream, getWellness, createWorkoutEvent, getEvents,
                                 deleteEvent, getAthleteMaxHr
lib/intervals/sync.ts         — syncIntervalsForUser (shared by manual route + cron + sync-on-open),
                                 claimAutoSync/releaseAutoSyncClaim (compare-and-swap debounce)
lib/intervals/crypto.ts       — AES-256-GCM encrypt/decrypt for intervals_tokens.api_key
lib/intervals/types.ts        — IntervalsActivity, IntervalsInterval, IntervalsWellness, IntervalsStream
lib/intervals/push-week.ts    — write plan workouts to the athlete's calendar (Phase 9)
lib/intervals/workout-format.ts — plan workout -> intervals.icu "% HR" description
```

Env vars: `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID` (scripts only — request paths read the encrypted DB row), `INTERVALS_TOKEN_KEY` (32-byte base64/hex, encrypts `intervals_tokens.api_key` at rest — service role bypasses RLS, so this app-level encryption is what actually protects write access to the athlete's calendar).

**Sync paths, all calling the same `syncIntervalsForUser`:**
1. `POST /api/intervals/sync` — manual "Sync Now" button, and (with `ifStaleMinutes`) automatic sync-on-open
2. `vercel.json` crons: `intervals-sync` at 15:00 and 21:40 UTC, `weekly-health-audit` Sundays 22:30 UTC
3. `lib/hooks/use-sync-on-open.ts` — fires when `/coach` mounts, debounced server-side, `AUTO_SYNC_STALE_MINUTES = 30`

**Duplicate-run protection is now in the storage layer, not just application logic:** `runs_user_filename_uniq`, a partial unique index on `(user_id, filename) WHERE filename IS NOT NULL` (migration `20260807_runs_user_filename_uniq.sql`). `lib/ingest/upsert-run.ts` catches the 23505 unique-violation and re-reads the winner's row rather than erroring or duplicating. This exists because sync-on-open made concurrent syncs possible for the first time; verified live with a synthetic user id (no FKs on `runs`, so fully isolated).

### Ingestion — the one file that owns it

`lib/ingest/upsert-run.ts` is the **single owner** of per-activity mapping (zones, classification, TRIMP, pace, laps, coach note) for every provider. A provider module (`lib/ingest/intervals.ts`) only produces a `NormalizedRun` / `NormalizedLap`; everything downstream is identical regardless of source.

Match order: exact `filename` → same user within 4h and ±2% distance (fuzzy) → insert. Updates are **fill-null-only** and preserve `id` always (`run_feedback.run_id` and `laps.run_id` are both `ON DELETE CASCADE` — never re-key or replace a row). The one exception: on a fuzzy match with `identityIsAuthoritative` set (intervals.icu only), `date` and `filename` are overwritten, because intervals.icu's timestamp comes from the Garmin FIT file and is authoritative over a Strava-era row that stored local time in a `timestamptz` column.

### The data-quality history you're building on top of

This matters for anything statistical you add:

- **Zones are only valid for 128 of 692 runs** (`pct_z1 IS NOT NULL`). 560 legacy rows were nulled 2026-08-06 after 204 were found to contain impossible Z6 data (time in Z6 with max HR below the Z6 floor). **A null zone must never render as 0% — it means "never measured," not "no time in that zone."**
- **`lactate_threshold_hr` = 165, `max_hr` = 191.** intervals.icu holds threshold at 173. Do not reconcile — the app's zones are %-of-max anchored on purpose (verified against measured Z4+ distributions), so the two systems' thresholds legitimately disagree and only max HR needs to match for write-back (Phase 9's gate checks exactly this).
- **`decoupling_pct` is grade-adjusted**, computed from per-lap `gap_pace_min_km`, NOT raw Pa:HR. Not comparable to a TrainingPeaks or Friel number. Gates: ≥6 laps with both pace and HR, laps outside **3–12 min/km discarded**, refuse if >10% of duration is discarded, halves within 40–60% of total time, `Intervals`/`Fartlek` excluded.
- **Friel's <5/5–8/>8 decoupling bands are deliberately NOT applied as verdicts anywhere in this app.** This athlete's own median is 6.8%, with roughly a third of runs above 8% — applying the conventional bands would call a third of his easy running "went too hard." Every surface (prompt, formatter, scorecard) renders a **percentile against his own history** instead. If you're tempted to add a colored badge or a pass/fail based on decoupling: **don't** — read `lib/utils/scorecard.ts`'s header comment and `lib/utils/scorecard.test.ts`'s first test, which exists specifically to stop this.
- **GAP (`gap_pace_min_km`) and cadence (`cadence_spm`) only exist from 2025-08-05 onward** (intervals.icu backfill date) — 127/692 runs. Any report older than that predates grade adjustment and can be wrong in a specific direction (raw pace overstates work on descending terrain by 36–48 s/km).
- **`athlete_profile.training_days` is stale and nothing validates it** (traced 2026-08-08, see `CLAUDE.md`). It says `"Monday (quality), Wednesday, Friday (long)"`; the athlete's actual distribution over the last active-plan window was Mon 8 / Wed 7 / Sun 5 / Sat 5 / Thu 2 / Fri 2 / Tue 1. This silently caps the weekly scorecard's judgeable coverage. **Relevant to this project**: whatever mountain plan gets generated will inherit this same field, so it needs correcting (or the new plan's days need to be entered deliberately) — see Chunk 0.

### Readiness, wellness, and the coach's judgment layer

- `lib/coach/readiness-service.ts` — `readinessForUser(userId, plan)` is the **single assembly point** for the GO/EASY/REST verdict. Both `/api/coach/stats` (dashboard tile) and `lib/coach/weekly-scorecard.ts` (scorecard) call this so they can never disagree.
- `lib/utils/readiness.ts` — pure `computeReadiness()`. Rules gate on both a reading AND its baseline being present; a missing HRV reading is never treated as a bad one. `RECOVERY_MAX_AGE_DAYS = 3` — readings older than that are withheld from the rules entirely (the nightly sync writes today's `daily_wellness` row before the watch has synced, so `hrv`/`sleep_secs`/`resting_hr` are usually null on the freshest row; `lib/db/wellness.ts`'s `getLatestRecoveryReading()` finds the latest row that actually has a reading, and callers must use that, not `getLatestWellness()`).
- `lib/utils/scorecard.ts` — weekly scorecard, three rows: zone discipline (coloured, gated at `MIN_JUDGED_COVERAGE = 0.5`), recovery (coloured, mirrors `computeReadiness`), aerobic control (**deliberately never coloured** — percentile only).
- `lib/utils/efficiency.ts` — Efficiency Factor, 42-day rolling median, season-matched baseline (84-day window centred one year back, refuses below 8 samples). Surfaced in the weekly review and coach context, **not** the dashboard — it moves too slowly to be a tile.
- `lib/utils/zone-discipline.ts` — intent (from the **plan's** `target_hr`, never `run_type`) vs actual zones. `parsePlannedZoneBand()` reads only the zone *label*; bpm in parens is ignored for this comparison (used the opposite way in `workout-format.ts` for write-back — see that file's header for why both are correct).

### Prompt architecture — where to add anything the coach must "know"

```
lib/ai/coach-prompts.ts
  COACH_STATIC_BLOCK          — persona + coaching rules. BYTE-STABLE, no per-request
                                 interpolation, carries the Anthropic cache_control
                                 breakpoint. THIS is where a permanent coaching rule goes
                                 (e.g. "every workout needs an indoor alternative").
  buildCoachDynamicBlock()    — per-request RAG context + task line. Used by /coach/ask.
  buildEnhancedCoachSystemPrompt() — static+dynamic CONCAT, used only by Grocky and
                                 plans/adjust — NOT by /coach/ask. A rule added only here
                                 will silently not reach the main chat. (This exact mistake
                                 was made once already in this project, for the Tier-3
                                 "show your numbers" rule — check placement before shipping.)
  buildEnhancedWeeklyAnalysisPrompt() — the weekly review's user-message template
```

`lib/rag/context-builder.ts` assembles the 3-layer RAG context; `lib/rag/user-formatter.ts` renders athlete data (runs, recovery, efficiency, plan) into text blocks the model reads. `TOKEN_BUDGETS_PER_QUERY` in `lib/rag/types.ts` sets per-query-type budgets.

RAG sources: `coaching_books` (7 rows, all road methodology — this is Chunk 3's gap), `coach_workouts` (69 rows, this athlete's actual previous-coach sessions), `user_resources`/`user_resource_chunks` (0 rows, empty — PDFs uploaded via `/coach/resources`).

### Timezone rule — do not violate this

`lib/utils/user-time.ts`, `USER_TIMEZONE = 'Asia/Jerusalem'`. Server runs UTC. **Never bare `new Date()` in a route or lib** for day/week boundary math — use `nowInUserTz()`, `userDateStr()`, `userDateStrDaysAgo()`. Two distinct classes of Date exist and are NOT interchangeable:
- a **true instant** → convert with `userDateStr(d)`
- a Date already **shifted** by `nowInUserTz()`/`dateInUserTz()` (correct calendar fields, deliberately wrong epoch) → convert with `shiftedDateStr(d)`, or `userDateStr` double-applies the timezone and silently shifts the date. This exact bug moved a plan week by a day (`weekStartDate` in `lib/intervals/push-week.ts`) before being caught by comparing against `calculateCurrentWeek`.

Client components may use bare `new Date()` — the browser is already in the user's timezone.

### Known traps recorded but not yet hit for real (from `CLAUDE.md`)

- **Non-running time inflates apparent undershoot** in zone-discipline — a session with real walking/hiking sits below its HR band by construction. **This is about to become a real instance, constantly, once mountain training starts** — power-hiking runs 15–20 min/km, which is exactly the band decoupling and efficiency currently exclude as noise (see Chunk 2). Recorded fix direction: gate on the pace band, don't blanket-exclude the session type — that would silence the case that matters most (a climb session that never reached its target effort).
- **Planned name ≠ what was run** — read `workout_name`/`run_type` for what happened; the plan only states intent.

### Standing rules for any session working in this repo

1. `bun run build` passes before every commit.
2. Never bare `new Date()` in a route or lib.
3. Never delete or re-key an existing `runs` row — `run_feedback` and `laps` cascade.
4. Show the plan for a phase before executing it (this doc *is* that plan, pre-approved per the sections below — but flag any deviation before making it).
5. A `null` must never render as a measurement, a zero, or a default. This is the single most-repeated lesson in this project's history — the corrupt zones, the fatigue-score-defaults-to-5 bug, the "fresh row exists but has no reading" wellness bug, and the scorecard's coverage gate were all instances of the same failure.
6. Verify against the live account/database before asserting a number. This project's own history contains multiple wrong claims that a live query would have caught in seconds (a two-August-medians estimate, an n=1 season baseline, a plan-generation "fix" that turned out to be a single stale profile field). Measure the window, not the sample.

---

## Status — updated 2026-09-03

Two of the four open decisions at the foot of this doc are now settled, and one chunk is built.

**Decision 1 (plan ownership): track + advise.** The athlete builds the mountain plan externally; the app tracks it and advises around it. **Chunks 4 and 6 are therefore out of scope** — no trail plan type, no `buildTrailPlanSection()`, no plan-form UI. Chunks 3 (RAG methodology) and 5 (indoor alternative) stay worth doing, since both improve Ask Coach regardless of where the plan lives.

**Chunk 1 (elevation capture): done**, commits `b12571b` and `e62720a` on `claude/mountain-race-handoff-a93e56`.

What landed: `runs.elevation_gain_m` / `elevation_loss_m`, generated `runs.vert_per_km`, `laps.elevation_gain_m`; provider mapping in `lib/ingest/intervals.ts`; writes through `upsertRun`; a new pure `lib/utils/elevation.ts` with tests; per-run and weekly rendering in `lib/rag/user-formatter.ts`; a reading guide in `COACH_STATIC_BLOCK`; two new `RunType` values; and dashboard / log / review UI.

Three findings from the pre-write probe that change what a later chunk should do:

- **Lap gain does not sum to run gain** — 130.4 m across laps against 210.9 m on the activity (i172836000), because intervals.icu laps are detected segments that do not tile the run. Lap elevation says *which segment* climbed and can never derive a run total. There is no per-lap loss field at all (0/191 sampled).
- **VAM is unusable** — `average_vertical_speed` is on 9/130 activities. No vertical TRIMP, no climb-rate metric. This is the 1d deferral, now measured rather than assumed.
- The 1e classification work was **smaller than scoped and 1c needed no new script**: `--rerun` on the existing backfill fills the new columns through ordinary fill-null-only enrichment. Its acceptance check did need fixing — it hardcoded a row count of 680 against a table that grows daily.

**Migration applied and backfill run, 2026-09-03.** 128 runs carry gain and loss; 1,168 lap rows across 99 runs carry per-lap gain. Snapshots at `runcoach._bak_20260903_runs` / `_bak_20260903_laps`. Measured after the backfill, confirming the pre-write probe: median 8.8, p90 11.7, max 20.2 m/km.

**The Supabase "outage" was not one.** Every DB call failed for most of the session with `Connection terminated due to connection timeout`, while management-API calls succeeded. Cause: the `supabase` MCP server is bound to project `ucjsnpnlxklaadqolpkx` — the OLD RunCoach project, which is **paused** (`INACTIVE`). You cannot open a Postgres connection to a paused project. That server's tools take **no `project_id` argument**, so the override this doc recommends is impossible there. **Use the other Supabase MCP server** (`mcp__f9ae2d57-…__execute_sql` / `apply_migration`), which takes `project_id` — pass `tlnqkxwlrewbtufnqiwi` (`ACTIVE_HEALTHY`).

⚠️ **One number in the first version of Chunk 1 was wrong and is now corrected.** `VERT_SESSION_MIN_M_PER_KM` shipped at 12 on the claim it fired on 1 of 128 runs; measured after the backfill it fired on **7**, five of them ordinary easy runs sitting at his p95 of exactly 12.0. The threshold is now **15**, clear of that cluster. The error came from interpolating between two probe buckets rather than measuring at the value actually being used — worth reading as the same failure shape this repo records for the n=1 season baseline and the two-August medians.

**Chunk 2 is now the live risk**, not a hypothetical: the 3–12 min/km pace-band gates in `decoupling.ts` and `efficiency.ts` will blank both metrics on power-hiking sessions. It stays blocked on real mountain data existing to calibrate against, which is what Chunk 1 now makes possible.

---

## Part B — Implementation plan

Dependency order: **0 gates everything** (a mountain plan judged against a road plan, or generated from a stale profile, produces garbage). **1 gates 2** (a trail plan is worthless if the app can't see the vert actually run). **3** should land before or alongside 2 (generating a trail plan from road-only RAG methodology produces a road plan with hills sprinkled on). **2's pace-band decision blocks nothing but must be made before 1's data starts flowing through the existing metrics**, or decoupling/efficiency start silently going dark on every mountain session.

```
0 ─┬─► 1 ──► pace-band decision ──► 2 ──► 5 (indoor alt.) ──► 6 (UI)
   │                    ▲
   └─────────────────── 3 (RAG methodology) ────────────────┘
```

### Chunk 0 — Stop grading against a fiction (do first, ~30 min, no code required)

1. **Deactivate the active road plan.** `training_plans` row `5de0dbf5...`, Half Marathon, started 2026-06-13, currently `status='active'`. While active it drives: readiness rule 1 (REST on the plan's rest days), rules 5/6 ("today is quality" per this plan), the morning-after coach note, and the scorecard's zone-discipline row — all judging the athlete against a plan he isn't following. `UPDATE runcoach.training_plans SET status = 'inactive' WHERE id = '5de0dbf5-4ad7-4e0b-ad23-a0a371aaa62c';` (confirm the id is still current before running — plans can change). With no active plan, readiness and the coach note fall back to load-and-recovery-only, which is honest.
2. **Refresh three stale `athlete_profile` fields** that currently read: `current_goal`/`long_term_goal` = *"Base building... 1:50 on half marathon"*, `active_goal_focus` = *"Build aerobic base for future 10K development after 2-month break"*, `training_days` = *"Monday (quality), Wednesday, Friday (long)"*. These feed plan generation and `COACH_STATIC_BLOCK`'s day anchors. Update via `/coach/settings` (preferred — goes through validation) or directly, once the athlete confirms the actual training days. Don't infer days from the run-history distribution and overwrite silently — that's a fact about his life, not something to derive from 9 weeks of data (this exact caution is recorded in `CLAUDE.md` from the day-alignment investigation).
3. **Decide whether the app should generate the mountain plan at all**, versus the athlete building one externally and the app only tracking + advising. Chunk 6 assumes the app generates it; if not, most of Chunk 2's plan-schema work is unnecessary and only the indoor-alternative rule (Chunk 5) and the RAG methodology (Chunk 3) are worth doing, since those improve Ask Coach regardless of where the plan itself lives.

### Chunk 1 — Elevation capture, end to end

**Smaller than it looks — intervals.icu already does the hard part.** Probed live 2026-09-03 across 130 run activities (2025-08-05 → 2026-09-03):

```
field coverage                      sample run (2026-08-30)
  total_elevation_gain      128/130   gain = 43.5 m
  total_elevation_loss      128/130   loss = 48.4 m
  use_elevation_correction  130/130   corrected = true
  average_altitude          127/130   (their own barometric/DEM correction,
  min/max_altitude          127/130    already applied server-side)
  average_vertical_speed      9/130
```

**Descent comes free.** `total_elevation_loss` is present at the same 128/130 rate as gain, on the summary payload already fetched by `getActivities`. No altitude-stream fetch, no smoothing threshold, no extra API call per activity, no rate-limit exposure — this removes the largest cost and risk item from the original draft of this plan, which assumed Strava's summary (gain only) and budgeted a per-activity stream call to derive loss.

`average_vertical_speed` (VAM) is present on only **9 of 130** — not usable as a training metric without computing it from the raw altitude stream. Lower-priority follow-up if per-climb intensity ever needs measuring on its own; the gain/loss totals cover the weekly-load question this plan is actually about.

**The number that should shape the whole training build.** Vert-per-km computed from the same probe (gain ÷ distance, n=127):

| | m/km |
|---|---|
| his historical minimum | 2.0 |
| **his median run** | **8.8** |
| **his steepest run ever** | **20.2** |
| **race day** | **61.9** |

The race is **~3× steeper than the steepest single run in his recorded history** and **7× his median**. That gap, not the 21 km distance, is the training problem — he is aerobically capable of the distance already and has never run anything close to the gradient. Everything in Chunk 4's periodization should be built against this, and it is the argument for starting vert-specific work early in an 11-month runway rather than treating it as a final-phase specialization.

**1a. Schema.** Add to `runs`: `elevation_gain_m INTEGER`, `elevation_loss_m INTEGER`, and a generated column `vert_per_km NUMERIC GENERATED ALWAYS AS (elevation_gain_m / NULLIF(distance_km, 0)) STORED`. Add `elevation_gain_m INTEGER` to `laps`. Follow the existing migration pattern (`supabase/migrations/20260806_gap_cadence.sql` is the closest precedent — same shape of change, added `gap_pace_min_km`/`cadence_spm` to both tables).

**1b. Types + mapping.** Add `total_elevation_gain` / `total_elevation_loss` to `IntervalsActivity` in `lib/intervals/types.ts` (and the per-lap equivalent to `IntervalsInterval` if the lap-level field exists there too — check on probe, not assumed). Map in `lib/ingest/intervals.ts`'s `toNormalizedRun`/`toNormalizedLap`. Write in `lib/ingest/upsert-run.ts` — this is **one file**, not the two-route change the original draft assumed (Strava's routes are dead; `upsertRun` is the single owner post-Phase-1).

**1c. Backfill.** Extend `scripts/backfill-intervals.ts` rather than building a new endpoint — it already does dry-run-by-default, `--commit` to write, against the same `upsertRun` path production uses. No new rate-limit handling needed: intervals.icu is 5,000/day and 2,500/15min, and this reuses the existing `getActivities` call (elevation is already on that payload) rather than adding a per-activity request.

**1d. `lib/utils/elevation.ts`** — new file, pure functions:
- `vertPerKm(gainM, distanceKm)` and a climb-category label (flat / rolling / hilly / mountain) with thresholds set from *this athlete's own distribution* — median 8.8, max 20.2 m/km, per the probe above — rather than invented generic bands. Follows the project's established pattern of deriving bands from the athlete's own data (same reasoning as decoupling's percentile approach). Note that his entire history sits below the race's 61.9 m/km, so the top category has no historical member yet; the labels must not imply otherwise.
- **Do not implement a Minetti-curve GAP.** `gap_pace_min_km` already exists (127/692 runs, supplied and converted at ingest) — a second grade-adjusted-pace computation in the same conceptual slot is precisely the "second, non-comparable measurement" `CLAUDE.md` already warns against for decoupling. If real GAP quality is ever in question, verify against intervals.icu's own numbers rather than recomputing.
- `verticalTrimp()` — deferred until VAM or a computed per-lap climb rate exists; without it there's no intensity signal to weight by, just gain, which the plan-vs-actual vert comparison already covers.

**1e. Classification — smaller than scoped.** `classifyRun` in `lib/utils/run-classifier.ts` takes **no pace input at all** — `maxHr` and `durationMin` are explicitly `void`ed, and it classifies from `zonePercents` (ground truth) with an avg-HR fallback plus `workoutName`/`lapCount`. There is no raw-pace-vs-GAP bug to fix here. What's worth adding: an optional `elevationGainM` param and two new `RunType` values (`'Vert / Hill'`, `'Trail Long Run'`), gated on `vertPerKm` crossing a threshold — additive, existing callers stay valid without change.

**1f. Surface it to the AI — this is the step that actually matters.** Elevation in the database with nothing reading it is exactly the GAP/cadence trap this project already fell into and fixed once (`docs/coach-analysis-gaps.md` Tier 1). In `lib/rag/user-formatter.ts`: per-run line gains `+340m (34 m/km)`; `formatTrainingStatus()` gains a weekly vertical total and a trend. Add a reading-guide line to `COACH_STATIC_BLOCK` next to the existing GAP/decoupling/HRV ones (same section, same pattern) — otherwise the coach has the number and no instruction on how to use it, which has been the recurring failure mode for every metric added so far.

**1g. UI.** Weekly vert on the dashboard (a genuine new tile is defensible here, unlike Efficiency Factor — vert changes weekly and drives a real weekly decision), a vert badge on run rows, a vert line on the review page.

### Chunk 2 — Resolve the pace-band gates before mountain data starts flowing (small, but blocks correctness — do before or alongside Chunk 1's rollout)

`lib/utils/decoupling.ts` and `lib/utils/efficiency.ts` both discard laps outside **3–12 min/km** and refuse the whole computation when too much of the session falls outside it. **Power-hiking sits at 15–20 min/km.** Once mountain training starts, both of the app's "is the training actually working" metrics will go dark on exactly the sessions that matter most for this goal, and the scorecard's aerobic-control row will read "not computed" most weeks.

This is the trap `CLAUDE.md` already records with "no real instance yet" — it's about to have many. The recorded guidance: **gate on the pace band, don't blanket-exclude by session type** — a blanket exclusion would silence the one case that matters most (a climb session that never reached its target effort). Concretely: widen the discard band for runs above a `vertPerKm` threshold (or for the new `Vert / Hill`/`Trail Long Run` types once Chunk 1e exists), rather than raising the global 3–12 ceiling for every run type and reintroducing the walking-lap contamination that band was built to prevent (6 of 68 runs at up to 21% decoupling from stray stairs/standing laps, per the original fix).

**This needs a decision, not just an implementation** — what the new ceiling should be, and whether it's global-with-a-flag or type-conditional — before Chunk 1's data starts landing in quantity.

### Chunk 3 — Trail methodology into RAG

All 7 loaded books are road/track: 80/20 Running, The Norwegian Method (×2), Run Elite, Run Faster 5K–Marathon, Better Training for Distance Runners, Endure. `COACH_STATIC_BLOCK` itself encodes only Triphasic/80/20/Norwegian. None of it covers vert periodization, eccentric/descent loading, power-hiking economy, or poles. `user_resources` is empty (0 rows) — nothing uploaded yet.

**Given the 11-month runway, prefer real books over a generated summary.** The athlete said he'll find sources himself — when he has PDFs, `/coach/resources` (`POST`, multipart form-data) chunks via `lib/rag/chunker.ts`, embeds via `text-embedding-3-small`, writes to `user_resources`/`user_resource_chunks`, and merges into the same "Methodology Guidelines" block the book retriever uses (`lib/rag/user-resource-retriever.ts`, called in parallel with book search by `lib/rag/book-retriever.ts`) — user resources go first so they win ties when the prompt truncates. Two candidate titles from the earlier review, offered as a starting point, not a purchase decision made here: *Training for the Uphill Athlete* (House/Johnston/Jornet) and *Training Essentials for Ultrarunning* (Koop).

If nothing is uploaded by the time Chunk 2's plan is generated, a structured reference authored specifically for this athlete's profile and race (vert periodization, descent progression respecting his plantar fasciitis history, power-hiking, poles, heat/fueling for long mountain efforts) via `scripts/load-books.ts` is the fallback — not the first choice, given the runway allows for the real thing.

Also worth seeding: `coach_workouts` with trail-specific sessions (vert intervals, downhill repeats, hike-run alternation, stair sessions) so Priority-2 retrieval has trail material to pull from — currently all 69 rows there are road sessions from the previous coach.

### Chunk 4 — Plan type + schema (only if Chunk 0.3 decides the app should generate the plan)

- `planGenerationSchema` (`lib/validation/schemas.ts`): add `'Trail / Mountain'` to the enum; optional `targetElevationGainM`, `targetRaceDate`, `terrainAccess`.
- `PlanWeek` gains `total_elevation_gain_m`; `Workout` (`lib/db/types.ts`) gains `elevation_gain_m`.
- A `buildTrailPlanSection()` in `lib/ai/coach-prompts.ts`, injected only when plan type is trail, encoding (subject to what Chunk 3's sources actually say, once loaded — don't hardcode numbers from a review a fresh session hasn't verified against real methodology):
  - vert periodization toward peak-week volume, capped weekly growth, down-weeks cutting vert before km
  - descent as its own stressor with an eccentric-tolerance progression that explicitly accounts for the athlete's **plantar fasciitis history** (`athlete_profile.injury_history`) — this is a real injury risk specific to this athlete, not a generic caveat, and downhill-specific loading should build gradually rather than being "discovered" during a long mountain run
  - long runs prescribed in time-on-feet + vert target rather than pace, since pace targets are close to meaningless on steep grade
  - poles: when introduced, and that race gear should be trained with, not met for the first time on race day
  - power-hiking framed as a trainable skill at this race's ~62 m/km average gradient, not a failure state
- Update the plan-generation `OUTPUT FORMAT` JSON example to include `elevation_gain_m` — the model won't emit a field it isn't shown in the example, this has been true for every schema addition so far.
- `plans/adjust/route.ts` must preserve the new fields through an adjustment round-trip.

### Chunk 5 — Indoor/gym alternative (global, not trail-only)

Per the athlete's stated interest in gym substitutes (stairs, incline treadmill/הליכון, stair climber). Two changes:
- `Workout` type gains `indoor_alternative?: { type, equipment, duration, description }`.
- A rule added to **`COACH_STATIC_BLOCK`** (not `buildEnhancedCoachSystemPrompt` — see Part A's prompt-architecture note; that function doesn't reach `/coach/ask`) instructing every prescribed workout to carry an indoor equivalent from a fixed equipment vocabulary. This reaches Ask Coach, Grocky, and plan generation/adjustment automatically once it's in the static block, since all three read from it.

**Worth naming explicitly in that rule, given this athlete's specific gap:** none of stairs, incline treadmill, or the stair climber train the *descending* half of a mountain effort — 1,300 m up means 1,300 m down, and eccentric quad/calf loading from descent is a distinct stressor gym climbing equipment doesn't replicate. If the methodology in Chunk 3 covers descent-specific gym substitutes (weighted step-downs, eccentric calf work), the static block should say so rather than implying stairs alone cover "vertical training."

### Chunk 6 — UI

Trail option in `planTypes`, elevation/date/terrain inputs on the plan-generation form, per-workout rendering of the indoor alternative (collapsible — don't clutter the week view, follow the pattern `components/coach/weekly-scorecard.tsx` already uses for progressive disclosure).

---

## Trail options near central Israel (pulled live, 2026-09-03)

Real routes with real elevation, from a trails lookup centred on the Jerusalem corridor (~30–45 min from central Israel) and a wider central-district sweep. Use these as concrete long-run venues once Chunk 1 can log vert against them — not as the final list, since "runnable trail" and "AllTrails-listed hiking trail" aren't identical and each should be checked in person first.

| Trail | Distance | Gain | Notes |
|---|---|---|---|
| Southern Sorek and Nes Harim Circuit | 7.7 km | 362 m | 47 m/km — closest single-loop match to race-day gradient feel |
| Har Yaala and Nahal Dolev Circuit | 10.5 km | 406 m | 39 m/km, Nahal Dolev Nature Reserve |
| Dolev River Circuit | 8.5 km | 328 m | |
| Beit Meir, Kisalon River and Mount Carmila | 6.6 km | 364 m | |
| Israeli National Trail & N. Nahal Kisalon Loop | 21.4 km | 558 m | closest single loop to actual race **distance** (21 km), though at ~26 m/km it's gentler than race grade — good for a long-run-in-time-on-feet session |
| Canada Park Loop | 17.4 km | 442 m | Ayalon Canada Park, popular, well-marked |
| Israel National Trail: Ben Shemen → Neve Shalom | 20.8 km | 620 m | 30 m/km, point-to-point — needs a car shuttle or return arrangement |

None of these individually match the race's **61.9 m/km** — expected, since that's a genuinely steep profile for this region. But read them against the athlete's *current* history rather than against race day: his steepest recorded run is **20.2 m/km**, so Southern Sorek at 47 m/km is already **2.3× steeper than anything he has run**, and every loop in this table exceeds his historical maximum. There is plenty of runway here before terrain becomes the limiting factor.

Practical approach once Chunk 1 can log vert: repeat the steepest available loop (Southern Sorek, 47 m/km) for gradient-specific work, use the 21 km loop (Nahal Kisalon, 26 m/km) for time-on-feet, and close the remaining gap to 62 m/km with repeats on the steepest segment rather than hunting for a single loop that matches race profile — which likely doesn't exist within range. Re-query nearer race season; training base may shift, and "AllTrails-listed hiking trail" is not the same claim as "runnable," so each needs checking in person.

---

## Open decisions for whoever picks this up

1. Does the app generate the mountain plan (Chunk 4/6) or only track+advise around an externally-built one? Changes how much of Chunk 4 is worth doing.
2. Chunk 2's pace-band ceiling for hike-run sessions — a specific number needs choosing, informed by real mountain-session data once some exists (Chunk 1 has to land first for this to be measurable rather than guessed).
3. Chunk 3's source — real PDFs (athlete is sourcing) vs. an authored reference, and the deadline for that decision before it blocks Chunk 4.
4. `athlete_profile.training_days` correction (Chunk 0.2) — needs the athlete's actual current weekly rhythm, which may itself be changing as mountain training begins.
