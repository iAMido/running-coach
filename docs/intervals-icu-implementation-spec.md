# intervals.icu migration — implementation spec

Build brief for Claude Code. Companion to `docs/intervals-icu-probe-findings.md`,
which contains the live API reconnaissance this spec is based on. **Read that file
first.** Every API fact here was verified against the real account on 2026-08-05 —
do not re-probe, and do not assume anything not written down.

Goal: replace Strava with intervals.icu (sourced from Garmin) as the training-data
provider, add a wellness/recovery layer the app has never had, and restore sync
after a five-week outage.

---

## Ground rules

1. **`bun run build` must pass before every commit.** Non-negotiable, per `CLAUDE.md`.
2. **Server-side day/week math uses `lib/utils/user-time.ts`** (`nowInUserTz`,
   `dateInUserTz`, `userDateStr`, Asia/Jerusalem). Never bare `new Date()` in a
   route or lib. Vercel runs UTC.
3. **Do not delete or re-key existing `runs` rows.** `run_feedback.run_id` and
   `laps.run_id` are both `ON DELETE CASCADE`. A delete silently destroys feedback
   and laps. Matched rows are UPDATEd in place, preserving `id`.
4. **Leave all Strava code in place.** Disable its crons only. Delete nothing until
   intervals.icu has run clean for two weeks.
5. Work phase by phase. Each phase ends with a green build and a commit.

## Environment

Already in `.env.local` (gitignored, verified):

```
INTERVALS_API_KEY=...
INTERVALS_ATHLETE_ID=i...
```

Add to Vercel env for deploy. `CRON_SECRET` already exists and is reused.

---

## Phase 0 — merge the 6 garmin↔strava duplicate pairs

**State:** a backup already exists at `runcoach._bak_20260805_runs` /
`_bak_20260805_laps` / `_bak_20260805_feedback` (38 runs, 114 laps, 0 feedback).
Three unambiguous duplicates were already deleted; run count is **666**.

Six pairs remain and must be **merged, not deleted**. Each is one run ingested
twice, 2.00 h apart. The `garmin` copy holds `pct_z1..pct_z6`; the `strava_sync`
copy holds the laps and the `coach_notes`.

Write `scripts/merge-duplicate-runs.ts` (one-shot, idempotent, `--dry-run` default):

1. Find pairs: same `user_id`, `|Δdate| <= 3h`, `|Δdistance_km| <= max(0.05, 2%)`,
   one row `data_source='garmin'` with `pct_z1 is not null`, the other
   `data_source='strava_sync'` with laps.
2. Copy `pct_z1..pct_z6` (and `trimp` if the strava row's is null) from the garmin
   row onto the strava row.
3. Delete the garmin row **only after** verifying it has zero laps and zero
   feedback rows.
4. Print a before/after table. Require an explicit `--commit` flag to write.

Expected affected dates: `2025-12-15, 12-18, 12-20, 12-22, 12-26, 12-29`.
Expected end state: **660 runs**.

> The 10 ambiguous 2022 pairs (`2022-11-07`…`2022-12-02`) are **out of scope**.
> Different `filename`s, both carry zones, neither carries laps. Leave them.

---

## Phase 1 — extract `lib/ingest/upsert-run.ts` (pure refactor)

The per-activity mapping logic is currently duplicated between
`app/api/strava/sync/route.ts` and `app/api/cron/strava-sync/route.ts`. Adding a
third copy for intervals.icu would be the wrong move. Extract first.

```ts
export interface NormalizedRun {
  externalId: string;          // becomes `filename`, e.g. "icu_i172834288"
  date: string;                // ISO, true UTC
  distanceKm: number;
  durationMin: number;
  avgHr?: number | null;
  maxHr?: number | null;
  calories?: number | null;
  workoutName?: string | null;
  dataSource: 'strava_sync' | 'intervals_sync' | 'fit_upload' | 'garmin';
  hrStream?: { hr: number[]; time: number[] | null } | null;
  laps?: NormalizedLap[];
}

export interface NormalizedLap {
  lapNumber: number;
  distanceKm?: number; durationSec?: number;
  avgHr?: number | null; maxHr?: number | null;
  avgPaceStr?: string | null;
}

export async function upsertRun(
  userId: string,
  run: NormalizedRun,
  ctx: { profile: AthleteProfile | null; zoneBands: ZoneBands; activePlan?: TrainingPlan | null },
): Promise<{ runId: string; created: boolean; lapsWritten: number }>;
```

Behaviour, lifted verbatim from the existing Strava routes:

- zone percents via `computeZonePercentsFromStream(hr, time, zoneBands)`
- `classifyRun({ distanceKm, avgHr, maxHr, durationMin, workoutName, profile, zonePercents })`
- `calculateTrimp({ durationMin, avgHr })`
- pace via `calculatePace` / `formatPace`
- laps inserted after the run row; backfill laps when an existing run has none
- `generateRunReaction` + `plannedWorkoutForRunDate` on newly created runs only,
  best-effort, never fails the sync

**Matching rule (this is the important part):**

1. Exact match on `filename = externalId` → UPDATE in place.
2. Else fuzzy match: same `user_id`, `|Δdate| <= 4h`, `|Δdistance_km| <= max(0.05, 2%)`
   → UPDATE that row in place, **preserving its `id`**, and enrich: fill null
   columns, add laps if it has none, never overwrite a non-null `coach_notes`.

> **Two amendments made during implementation.**
>
> **Window widened 3h → 4h.** A row storing Israel local time sits exactly
> 3.0000h from truth in summer — dead on a `<= 3h` boundary, where a second of
> drift turns a correction into a silent duplicate insert. Verified safe against
> all 660 runs: widening admits one new pair (2025-03-22, 2.76 km vs 26.27 km)
> which the distance test rejects by 23.5 km.
>
> **`date` and `filename` are overwritten on a fuzzy match** when the provider
> is marked authoritative, because fill-null-only can never repair a wrong
> timestamp (`date` is never null). 11 rows from a bulk import on 2026-01-14
> hold local time; the 39 live-sync rows were always correct. Gated so only
> intervals.icu does this — otherwise the two providers rewrite each other's
> identity on alternating syncs.
3. Else INSERT.

Rule 2 is what prevents the backfill from duplicating the 98 runs already present
and from orphaning the 27 `run_feedback` rows.

Refactor both Strava routes onto this. **No behaviour change.** Build must pass and
a manual Strava sync must still work identically before moving on.

---

## Phase 2 — schema

`supabase/migrations/<ts>_intervals_icu.sql`:

```sql
create table if not exists runcoach.intervals_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  api_key text not null,              -- encrypted at rest, see note
  athlete_id text not null,
  -- forward slots for OAuth, additive, no future migration needed
  access_token text, refresh_token text, expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table runcoach.intervals_tokens enable row level security;

create table if not exists runcoach.daily_wellness (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  day date not null,
  ctl numeric, atl numeric,           -- fitness / fatigue (form = ctl - atl)
  resting_hr int, hrv numeric,
  sleep_secs int, sleep_score int, sleep_quality int,
  weight_kg numeric, steps int, vo2max numeric,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, day)
);
alter table runcoach.daily_wellness enable row level security;
create index on runcoach.daily_wellness (user_id, day desc);
```

### Phase 2b — update `athlete_profile` to the new HR anchors

Max HR was corrected to **191** on 2026-08-05, already live on Garmin and in
intervals.icu. `runcoach.athlete_profile` is still on the old value and **must be
updated or every newly synced run will be classified against stale bands** —
`parseZonesFromProfile` reads this row, not Garmin.

> **Threshold HR stays at 165 — do NOT raise it to 173.** An earlier draft of
> this document said 173 (intervals.icu's value); that was premature. 173 is a
> peak-fitness threshold inferred from a 2023 half marathon, but current CTL is
> 17.7 and the hardest recent session peaked at 166 — below what 173 assumes.
> The real threshold is unknown until tested; 165 is the closer placeholder.

Current row: `max_hr 185`, `lactate_threshold_hr 165`, `resting_hr 51`, bands
`0-120 / 120-138 / 138-150 / 150-162 / 162-175 / 175-185`.

Those bands are a %-of-max model (≈65 / 75 / 81 / 88 / 95 / 100%). Rescaled to 191,
preserving the same shape:

| Zone | Old (max 185) | New (max 191) |
|---|---|---|
| Z1 | 0–120 | 0–124 |
| Z2 | 120–138 | 124–143 |
| Z3 | 138–150 | 143–155 |
| Z4 | 150–162 | 155–168 |
| Z5 | 162–175 | 168–181 |
| Z6 | 175–185 | 181–191 |

**CONFIRMED and APPLIED 2026-08-05.** `max_hr = 191` and the six bands above.
`lactate_threshold_hr` left at 165; `resting_hr` untouched at 51.

### Why %-of-max and not threshold-anchored zones

Decided against measured data, not preference. Z4+ time on the last 10 runs
under each candidate model:

| Run | OLD (max 185) | chosen: %max→191 | LTHR-anchored 173 | icu native |
|---|---|---|---|---|
| 2026-08-03 Threshold Intervals | 26.0% | 15.4% | 2.7% | 3.9% |
| 2026-08-01 Long Run | 59.2% | 46.0% | 21.6% | 24.5% |
| 2026-07-25 Long Run | 29.7% | 21.8% | 13.0% | 13.7% |
| runs tripping readiness rule 3 (Z4+ > 40%) | 1/10 | 1/10 | 0/10 | 0/10 |

A threshold-anchored model silently disables rule 3 in `readiness.ts` — nothing
in six weeks would register as hard, including a long run that plainly was. Max
HR is a stable anchor; threshold moves with fitness and his has dropped a long
way. The rescale also minimises discontinuity against ~660 runs of %max-based
history.

**Do not revisit this without re-running the same comparison.**

**Do NOT recompute historical `pct_z1..pct_z6`.** Decided: new zones apply going
forward only. The ~660 existing runs keep their old-zone percentages. Record the
cutover date in `CLAUDE.md` so future work knows the series has a documented
discontinuity and does not "fix" it.

---

**`api_key` must be encrypted at rest.** It grants write access to the athlete's
training calendar, and `lib/db/supabase.ts` uses the service role, which bypasses
RLS — so RLS is not protecting it. Use pgcrypto or app-level AES with a key from
env. Do not store it plaintext.

Columns deliberately omitted because intervals.icu returns them empty across all
366 days: `bodyBattery`, `readiness`, `stress`, `respiration`, `spO2`,
`avgSleepingHR`. Those are Garmin-native and do not propagate.

---

## Phase 3 — `lib/intervals/client.ts`

```
BASE = https://intervals.icu/api/v1
```

Three verified gotchas — get these wrong and it fails in confusing ways:

1. **Basic auth, username is the literal string `API_KEY`.** Not the athlete id,
   not the key. `Authorization: Basic base64("API_KEY:" + apiKey)`.
2. **A custom `User-Agent` is mandatory.** Cloudflare 403s default agents
   (`node-fetch`, `undici`, `python-requests`). Send `RunCoach/1.0`. A `403` on a
   valid key is almost always this.
3. `athleteId` of `"0"` means "the authenticated athlete" and works as a fallback.

Errors: `401` = bad/regenerated key. `403` = User-Agent. Limits: 5,000/day,
2,500/15min — irrelevant at this volume but back off on `429`.

Endpoints needed:

| Purpose | Call |
|---|---|
| Activities | `GET /athlete/{id}/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD` |
| Laps | `GET /activity/{id}/intervals` → `.icu_intervals[]` |
| HR stream | `GET /activity/{id}/streams?types=heartrate,time` → `[{type,data[]}]` |
| Wellness | `GET /athlete/{id}/wellness?oldest=…&newest=…` |
| Events (write) | `POST /athlete/{id}/events` — phase 8, not now |

### Field mapping — activity → `NormalizedRun`

| Target | Source | Note |
|---|---|---|
| `externalId` | `"icu_" + id` | ids look like `i172834288` |
| `date` | `start_date_local` | **local time.** Convert to true UTC via `lib/utils/user-time.ts`. Do not store it raw — that is exactly the bug that produced the 2-hour-offset duplicates. |
| `distanceKm` | `distance / 1000` | metres |
| `durationMin` | `moving_time / 60` | seconds |
| `avgHr` / `maxHr` | `average_heartrate` / `max_heartrate` | 116/117 populated |
| `calories` | `calories` | |
| `workoutName` | `name` | |

Filter to runs: `type` in `Run`, `VirtualRun`. (Account also contains
`WeightTraining`, `Swim`, `Ride`, `VirtualRide`, `Hike`, `Elliptical`, `Pilates`.)

### `icu_intervals[]` → `NormalizedLap`

`moving_time` (s), `distance` (m), `average_heartrate`, `max_heartrate`,
`average_speed` (m/s → `formatPace`). Index order gives `lapNumber`.

Also available and richer than Strava ever gave: `min_heartrate`, `gap`
(grade-adjusted pace), `intensity` (% of threshold), `type` (`WORK`/`RECOVERY`).
Not in the `laps` schema today — consider adding `intensity` and `gap` in a later
phase to sharpen the weekly-review per-rep commentary.

### ⚠️ Zones — do NOT use `icu_hr_zone_times`

Tempting (it is on the activity summary, 115/117 populated) and **wrong**.
intervals.icu's zone boundaries disagree with `athlete_profile`:

- app Z4 = `150–162`, intervals.icu Z4 = `163–172`
- app max HR `185` / LTHR `165`; intervals.icu `191` / `173`

Using it would redefine "Z4" partway through the history and break
`yesterdayHardPct` in `readiness.ts` (thresholds on `pct_z4+z5+z6 > 40`), the
`Intervals` branch of `classifyRun`, and every past zone claim the coach has made.

**Always** fetch the HR stream and run the existing
`computeZonePercentsFromStream(hr, time, parseZonesFromProfile(profile))`. One
zone definition — the athlete's — across all 660 runs.

### Wellness mapping

`id` **is the date** (`YYYY-MM-DD`), not a row id. Map `ctl, atl, restingHR, hrv,
sleepSecs, sleepScore, sleepQuality, weight, steps, vo2max`. Upsert on
`(user_id, day)`. Fill rates last 60 days: hrv 100%, sleep 98%, restingHR 100%,
ctl/atl 100%, weight 44%, vo2max 46%.

---

## Phase 4 — sync route + cron

- `app/api/intervals/sync/route.ts` — POST, `getAuthenticatedUser()`, Zod-validated
  `{ daysBack }`, mirrors the Strava sync response shape
  (`{ newRunsCount, lapsBackfilledCount }`) so the UI is a straight port.
- `app/api/cron/intervals-sync/route.ts` — GET, `Bearer ${CRON_SECRET}`, loops all
  `intervals_tokens` rows. Also pulls wellness for the same window.
- `vercel.json`: point the two existing schedules at `/api/cron/intervals-sync`.
  Keep `weekly-health-audit` untouched. Remove the `strava-sync` entries but leave
  the route file in place.

Fetch profile and active plan **once per user per request** and thread them down —
same pattern as the Strava routes.

---

## Phase 5 — webhook

`app/api/intervals/webhook/route.ts`. intervals.icu supports webhooks for activity
upload; register the endpoint and verify the shared secret on every call. On
receipt, sync just that activity.

Cron stays as the backstop — the webhook is an optimisation, not a replacement.
Payoff: runs land seconds after Garmin uploads instead of waiting up to 12 h, which
makes the dashboard's 36-hour `coach_notes` window and the readiness verdict
actually same-day.

---

## Phase 6 — `/coach/intervals` page

Port `app/coach/strava/page.tsx` wholesale. Only the connect card changes:

- **Not connected:** two inputs (API key, athlete ID), a Save button, and a link to
  `https://intervals.icu/settings` → Developer Settings. Note in the UI that the
  key grants write access.
- **Connected:** status badge + Disconnect (deletes the token row).
- Everything else — "Days to Sync" select, "Sync Now", the result message, the GPX
  upload block — carries over unchanged.

Add the nav entry in `components/coach/sidebar.tsx`. Leave the Strava page reachable
until cutover is confirmed.

---

## Phase 7 — backfill

`scripts/backfill-intervals.ts`, `--dry-run` by default, `--commit` to write.

Pulls the last 400 days and runs everything through `upsertRun`. Verified expected
outcome against the live account:

- **117 runs** available, `2025-08-05` → `2026-08-03`
- **98 already in the DB** → UPDATE in place (enrich only, preserve `id`)
- **19 missing** → INSERT

The 19 missing runs — the app has been dark since `2026-06-29`:

```
2025-09-03   9.01 km  Running          2026-07-19   4.59 km  Easy Run
2025-09-17   2.78 km  Running WU       2026-07-20   7.42 km  Tempo
2026-07-02   5.14 km  Running          2026-07-22   4.93 km  Easy Run
2026-07-05   5.06 km  Easy Run         2026-07-25  11.73 km  Long Run
2026-07-06   5.53 km  Easy Run         2026-07-27   4.73 km  Easy Run
2026-07-08   4.22 km  Easy Run         2026-07-29   4.19 km  Easy Run
2026-07-11  10.03 km  Running          2026-08-01   8.75 km  Long Run
2026-07-13   6.55 km  Fartlek          2026-08-02   5.30 km  Running
2026-07-15   4.63 km  Easy Run         2026-08-03   9.23 km  Threshold Intervals
2026-07-17  10.95 km  Long Run
```

Also backfill laps for the year — only **50 of 660** runs have laps today, so this
is a large free upgrade to the RAG context. And backfill 365 days of wellness.

**Take a fresh `_bak_` snapshot of `runs` before running with `--commit`.**

---

## Phase 8 — wire wellness in (do not skip)

Without this the pipeline is plumbing to nowhere. This is where the user-visible
value actually lands.

**`lib/utils/readiness.ts`** — extend `ReadinessInput` with `hrv`, `hrvBaseline`
(28-day rolling mean), `sleepSecs`, `sleepScore`, `restingHr`, `rhrBaseline`.
Suggested v2 rules, keeping the existing conservative shape:

- HRV more than ~1 SD below baseline **and** planned quality today → `EASY`
- HRV well below baseline two days running → `REST`
- sleep < 5 h → cap at `EASY` regardless of fatigue score
- resting HR ≥ 5 bpm over baseline → contributes to fatigue

**Degrade gracefully.** HRV is null 12% of the year (nights the watch was off).
Missing HRV must never read as bad HRV — fall back to the existing training-load
logic and say so in `reasons`.

**`lib/rag/user-formatter.ts`** — add a "Recovery (last 7 days)" block: HRV vs
baseline, sleep hours + score, resting HR, and Fitness/Fatigue/Form from `ctl`/`atl`.
Translate the jargon in the prompt text: `ctl`→Fitness, `atl`→Fatigue,
`ctl-atl`→Form. Current values for sanity-checking the render: **17.7 / 18.6 / −0.9**.

**`lib/supervisor/preflight.ts`** — add a warning when the newest `daily_wellness`
row is more than 2 days old, so the coach flags the gap instead of confabulating
recovery status.

---

## Phase 9 — write-back (separate, after everything above is stable)

`POST /athlete/{id}/events` puts a structured workout on the watch. This is the
feature neither Strava nor a Garmin scraper could ever provide.

```json
{
  "category": "WORKOUT",
  "start_date_local": "2026-08-10T00:00:00",
  "type": "Run",
  "name": "5x3min threshold",
  "moving_time": 3000,
  "description": "- 15m Z2 HR\n\n5x\n- 3m Z4 HR\n- 2m Z1 HR\n\n- 10m Z2 HR"
}
```

**The zone trap — verified, and it will bite.** The event's `target` field is
**ignored** by the workout parser. Only the suffix inside `description` decides:

- `- 15m Z2` → **power** zone (watts — wrong for running)
- `- 15m Z2 HR` → heart-rate zone
- `- 15m Z2 Pace` → pace zone

Bake `HR` or `Pace` into the mapper so nobody has to remember. Syntax: `5x` alone on
a line opens a repeat block, indented steps repeat, a blank line closes it.
Undo: `DELETE /athlete/{id}/events/{event_id}`.

Surface as a "Push to watch" action on `/coach/plan` mapping a `PlanWeek` →
events. Note intervals.icu only uploads ~7 days ahead, so a workout 3 weeks out
will not reach the watch yet.

**Prerequisite — max HR agrees, threshold does NOT.** Phase 2b landed
2026-08-05: max HR is 191 across Garmin, intervals.icu and `athlete_profile`.
But `athlete_profile.lactate_threshold_hr` is **165** while intervals.icu holds
**173**, and intervals.icu's zone boundaries are threshold-anchored.

So `Z4 HR` in a pushed workout resolves against *intervals.icu's* Z4
(163–172), not the app's Z4 (155–168). The coach prescribing "Z4" and the watch
displaying "Z4" are not the same band — they overlap but the watch's is ~8 bpm
higher at the bottom.

Do not ship write-back until this is resolved, by one of:
1. an actual threshold test, then align all three systems on the measured value;
2. emitting absolute BPM ranges in the description instead of zone names, which
   sidesteps whose zones win entirely (safest, and probably correct anyway);
3. rewriting app zone numbers into intervals.icu zone numbers in the mapper.

Option 2 is recommended — a workout that says `- 3m 155-168 HR` cannot be
misinterpreted by either system.

---

## Verification checklist

- [ ] `bun run build` green after every phase
- [ ] Run count `666 → 660` after Phase 0 merge, no `run_feedback` orphans:
      `select count(*) from runcoach.run_feedback f left join runcoach.runs r on r.id=f.run_id where r.id is null;` → should stay at **1** (a pre-existing orphan), not grow
- [ ] Backfill dry-run reports 98 matched / 19 inserted before any `--commit`
- [ ] After backfill, newest run is `2026-08-03`, not `2026-06-29`
- [ ] Spot-check the `2026-08-03` Threshold Intervals run: has laps, has
      `pct_z1..pct_z6`, and `run_type` classifies as `Intervals`
- [ ] Zone percentages on a newly synced run match what the old Strava pipeline
      produced for a comparable run — proves the athlete's zone definition survived
- [ ] `/coach` dashboard readiness badge renders with wellness present *and* with
      wellness missing
- [ ] Manual "Sync Now" returns the same result shape the Strava page showed
- [ ] Cron endpoint rejects a request without `Bearer ${CRON_SECRET}`
