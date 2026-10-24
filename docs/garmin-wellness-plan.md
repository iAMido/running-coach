---
title: Garmin Personal API → RunCoach wellness
project: RunCoach
status: steps 0-6, 8, 9 shipped; step 7 measured and deferred (too few outcomes)
created: 2026-10-24
updated: 2026-10-24
repo: iAMido/running-coach
branch: feat/garmin-personal-api-probe
tags: [runcoach, garmin, wellness, readiness, plan]
---

# Garmin Personal API → RunCoach wellness

> [!summary]
> Add Garmin's official **Personal API** (launched 2026-10-21) as a **second wellness source next to intervals.icu**. It does not replace intervals.icu. The new inputs are body battery, stress, sleep stages and HRV status, which intervals.icu returned **empty on all 366 days probed**. intervals.icu keeps activities, laps, streams, GAP, CTL/ATL and the push to the watch.
>
> Ten steps. Step 0 is a measurement with a go/no-go decision. Steps 1–5 and 8 are PR 1, 6 and 9 are PR 2, and 7 comes weeks later.

---

## 1. Why: what each source does

| capability | intervals.icu (today) | Garmin Personal API |
|---|---|---|
| Activities, laps, HR stream | ✅ JSON | ⚠️ summary JSON; laps/streams only via FIT decode |
| Grade-adjusted pace (GAP) | ✅ `gap` | ❓ maybe `avgGradeAdjustedSpeed` on summary |
| CTL / ATL (fitness/fatigue) | ✅ | ❌ |
| Push workouts to watch | ✅ (`push-week.ts`) | ❌ read-only. The Training API is business tiers only |
| HRV, resting HR, sleep duration/score | ✅ (relayed from Garmin) | ✅ native |
| **Body battery** (high/low/charged/drained, events) | ❌ empty 366/366 days | ✅ |
| **Stress** (daily avg + max) | ❌ empty | ✅ |
| **Sleep stages** (deep/light/REM/awake) | ❌ | ✅ |
| **HRV status / baseline band / weekly avg** | ❌ | ✅ (expected) |
| Respiration, SpO2, avg sleeping HR | ❌ empty | ❓ probably inside sleep/daily summaries |
| Training readiness / training status | ❌ | ❌ (`metrics-service` is not on the allowlist) |
| History depth | ~400 days probed | **"back to the day you set it up"** (claimed; to be verified) |

> [!warning] Why not replace intervals.icu
> 1. **Push to the watch would be lost.** The Personal API is GET-only.
> 2. Laps would come from FIT decoding, a different segmentation from the intervals.icu laps that decoupling, the backfill alignment check and the scorecard rely on (see CLAUDE.md, "`laps` holds two populations").
> 3. GAP from a second source in the same column breaks comparability. That is the rule from "No Minetti GAP, ever".
> 4. CTL/ATL would have to be recomputed by the app.

---

## 2. What is known and what is assumed

| fact | confidence | source |
|---|---|---|
| Key is created in Garmin Connect **web** → Personal API Key page → Create Key → accept T&C → choose expiry → Create. **Shown once.** | ✅ confirmed | Garmin page (pasted 2026-10-24) |
| Token: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>` | ✅ confirmed | Garmin page |
| Key expiry choices: 30 / 90 / 180 / 365 days. Garmin emails ~7 days before expiry | ✅ | Garmin FAQ |
| Access token lasts 24 h (or until the key expires); **no refresh token**, so a new one is minted from the key | ✅ | Garmin FAQ |
| Calls use `Authorization: Bearer <token>` | ⚠️ assumed | third-party write-ups |
| 26 GET endpoints; unlisted paths return 404 | ⚠️ | tamcore/garmin-mcp#42 |
| Endpoint paths (below) | ⚠️ | tamcore/garmin-mcp#42 |
| Query parameter names, date formats, maximum range per call | ❓ | Step 0 |
| Rate limits | ❓ undocumented | Step 0 |
| Full history available | ⚠️ claimed | Athlete AI / Kevin Rudd slide |
| Personal use only, "not intended for commercial applications serving multiple end users" | ✅ | Garmin FAQ. This app has one athlete, so it fits |
| Whether the terms allow passing data to LLM providers | ❓ | **you, by reading the T&C** — see §5 |

**Endpoints — official Swagger (Garmin Connect Personal API 1.0.0, OAS3, seen 2026-10-24), host `personal.connectapi.garmin.com`:**

```
activity-service         GET /activity-service/activity/{activityId}
                         GET /activity-service/activity/{activityId}/workouts
activitylist-service     GET /activitylist-service/activities/search/activities
biometric-service        GET /biometric-service/heartRateZones/v2
download-service         GET /download-service/files/activity/{activityId}          # original FIT (zip)
fitnessage-service       GET /fitnessage-service/fitnessage/v2/{calendarDate}
goal-service             GET /goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}
hrv-service              GET /hrv-service/hrv/{calendarDate}
                         GET /hrv-service/hrv/daily/{fromDate}/{toDate}
nutrition-service        GET /nutrition-service/food/logs/{date}
periodichealth-service   GET /periodichealth-service/menstrualcycle/summary/{calendarDate}
                         GET /periodichealth-service/menstrualcycle/dayview/{calendarDate}
sleep-service            GET /sleep-service/sleep/dailySleep
                         GET /sleep-service/sleep/dailySleepSummariesByDate
userprofile-service      GET /userprofile-service/userprofile/settings
usersummary-service      GET /usersummary-service/stats/hydration/daily/{startDate}/{endDate}
                         GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}
                         GET /usersummary-service/stats/stress/daily/{startDate}/{endDate}
                         GET /usersummary-service/usersummary/daily
                         GET /usersummary-service/v2/dailysummaries
weight-service           GET /weight-service/weight/all/{startDate}/{endDate}
                         GET /weight-service/weight/range/{startDate}/{endDate}
wellness-service         GET /wellness-service/wellness/bodyBattery/reports/daily
                         GET /wellness-service/wellness/daily/spo2acclimation/{calendarDate}
                         GET /wellness-service/wellness/dailyHeartRate
wellnessactivity-service GET /wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}
```

Notable schemas: `UserDailySummaryV2DTO` carries `StressV2DTO`, `BodyBatteryV2DTO` (+ activity events), `RespirationV2DTO`, `PulseOxV2DTO`, `HeartRateV2DTO`, `IntensityMinutesV2DTO`, `JetLagV2DTO`; `HrvSummaryDTO` + `BaselineScoreDTO`; `DailySleepDTO` + `SleepScoreItem` + `SleepNeedDTO`; `BodyBatteryDynamicFeedbackEventDTO`. No training readiness / training status anywhere — confirmed.

**Measured 2026-10-24 (first probe run, 60 days):**
- Token exchange works; `Accept: application/json` on it returns **406** — send no Accept header.
- ✅ activities (20 returned for `limit=50`), activity detail, workouts, FIT (115 KB zip), HRV range (60 days in one call), HRV day, dailySleep, v2 dailysummaries (60 days in one call), user settings.
- Activity summary carries `avgGradeAdjustedSpeed` (m/s) and `averageRunningCadenceInStepsPerMinute` (true spm — `toCadenceSpm`'s <120 guard leaves it alone).
- `dailySleep` carries stages, scores, avg sleeping HR, SpO2 (avg/low/high), respiration (avg/low/high), `avgSleepStress`, `awakeCount`, `sleepNeed`.
- ❌ `bodyBattery/reports/daily` with a 60-day range → **400** (range limit or param names; body battery may come from v2 daily summaries instead).

---

## 3. Design decisions

> [!important] D1 — a separate table, not new columns on `daily_wellness`
> `upsertWellnessDays` (`lib/db/wellness.ts`) **overwrites the whole row** on every intervals.icu sync, deliberately, because intervals.icu recalculates CTL/ATL retroactively. Any Garmin value stored in a shared column would be overwritten on the next sync, often with null. A separate table also keeps provenance: `runs.data_source` shows the cost of losing it.

> [!important] D2 — merge in one place only
> Only `lib/db/wellness.ts` reads `garmin_daily_wellness`. Readiness, the coach context, training-state and the UI keep calling the same functions as today. The same pattern as `training-state.ts` and `readinessForUser`: one assembly point, so the coach and the app cannot reason from different numbers.

> [!important] D3 — no merging of overlapping fields (decided by measurement, 2026-10-24)
> In the measured 60-day window intervals.icu has `hrv`, `resting_hr`, `sleep_secs` and `sleep_score` on **61/61** days, so there are no gaps to fill. intervals.icu stays the **only** source for those four. Garmin contributes only what intervals.icu lacks: body battery, stress, sleep stages and components, HRV status/baseline band, respiration, SpO2, sleep need. One check remains: Garmin's `lastNightAvg` should equal intervals.icu's `hrv` on the same date. Otherwise Garmin's HRV status would sit next to another night's value. See [[garmin-personal-probe-findings]].

> [!important] D4 — no new cron
> There are already 4 crons on Hobby, and the 4th is unconfirmed. The Garmin sync is a separate best-effort block **inside** `/api/cron/intervals-sync` plus the existing sync-on-open (`/api/intervals/sync` + `claimAutoSync`). A Garmin failure is recorded in `errors[]` and never fails the intervals.icu sync.

> [!important] D5 — information first, verdicts later
> The new fields reach the coach and the screen first as **observations**. A new readiness rule is added only after calibrating against his own distribution (Step 7). Garmin's thresholds are not adopted, for the same reason Friel's bands were rejected.

> [!important] D5b — absent is null, never 0
> A body battery of 0 reads as total exhaustion and stress 0 reads as total calm. A missing field is null, and readers must render "not measured".

---

## 4. Steps

### Step 0 — Probe and measurement (go/no-go)

**What exists:** `scripts/probe-garmin-personal.ts` (read-only; writes raw JSON to `garmin-probe/`, which is gitignored).

**You do:**
- [ ] Garmin Connect web → Personal API Key → Create Key → **read the T&C** (see §5) → expiry of **1 year** (minimum maintenance) → copy.
- [ ] Add to `.env.local`: `GARMIN_PERSONAL_API_KEY=...`
- [ ] Run: `bunx tsx scripts/probe-garmin-personal.ts --days 60`
- [ ] Run again: `--days 365` (history test)
- [ ] Paste the **console output** to Claude, not the raw JSON. It contains health data.

**Claude does after that:**
- [ ] Fix the guessed query parameters on whichever probes failed (404/400) and re-run.
- [ ] Extend the probe with:
  - [ ] **Coverage:** for each candidate field, how many days out of N it is present (as in the 366-day intervals.icu probe).
  - [ ] **Overlap:** a read-only join against `runcoach.daily_wellness` on `day`. For each of hrv / resting_hr / sleep_secs / sleep_score: identical / within 1% / different / only one side. Run the same comparison again with a ±1 day shift to detect day attribution.
  - [ ] **Day attribution:** which date the night of 23→24 is filed under in each source.
  - [ ] **Availability time:** run at 06:30, 08:00 and 10:00 IL on one day; when does last night appear?
  - [ ] **Range limits:** the largest range accepted per endpoint (7 / 28 / 31 / 90 / 365 days).
  - [ ] **History:** the earliest date that returns data. Does the "whole history" claim hold?
  - [ ] **Rate:** record any 429/403 and how many calls preceded it.
- [ ] Write `docs/garmin-personal-probe-findings.md` in the shape of `intervals-icu-probe-findings.md`.

**Go/no-go criterion:**
> [!check] Continue to Step 1 only if
> body battery **or** sleep stages are present on **≥80%** of days over 60 days. Otherwise stop: a second copy of numbers we already have is not worth maintaining.

**Estimate:** about 1 h of your time spread over a day (because of the availability test), about 1–2 h for Claude.

---

### Step 1 — Credentials and client

**Files:**
- `supabase/migrations/2026MMDD_garmin_personal.sql` (new; the same file covers Step 2)
- `lib/garmin/client.ts` (new)
- `lib/garmin/types.ts` (new)
- `lib/db/types.ts` (add `GarminToken`)

**Table `runcoach.garmin_tokens`:**

```sql
CREATE TABLE IF NOT EXISTS runcoach.garmin_tokens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 text NOT NULL UNIQUE,
  api_key                 text NOT NULL,          -- AES-256-GCM blob via lib/intervals/crypto.ts, never plaintext
  key_expires_at          date NOT NULL,          -- entered at connect time; the API may not report it
  access_token            text,                   -- encrypted as well: it reads all health data for 24h
  access_token_expires_at timestamptz,
  last_sync_at            timestamptz,
  last_success_at         timestamptz,            -- separate from last_sync_at, which claimAutoSync uses to mean "started"
  last_error              text,
  cooldown_until          timestamptz,            -- set on a 429; every sync respects it
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);
ALTER TABLE runcoach.garmin_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.garmin_tokens FROM anon;
```

**`GarminClient` (`lib/garmin/client.ts`), in the same structure as `IntervalsClient`:**

```ts
export class GarminApiError extends Error { status: number; path: string }
export class GarminClient {
  constructor(opts: { apiKey: string; cachedToken?: { token: string; expiresAt: Date } | null;
                      onToken?: (t: { token: string; expiresAt: Date }) => Promise<void> })
  private async ensureToken(): Promise<string>        // exchange when missing or <1h left
  private async request<T>(path: string): Promise<T>  // one re-exchange on a 401; a 429 throws GarminRateLimited
  getHrvRange(from: string, to: string)
  getSleep(date: string)
  getBodyBattery(from: string, to: string)
  getDailySummaries(from: string, to: string)
  getStress?(...)                                      // only if Step 0 finds a separate endpoint
}
export async function garminClientForUser(userId: string): Promise<GarminClient | null>
```

- [ ] `onToken` persists the new token (encrypted), so the cron and sync-on-open share one token instead of exchanging on every call.
- [ ] A 429 sets `cooldown_until = now + Retry-After` (or 1 h when absent).
- [ ] Every outgoing request has a 10 s timeout.
- [ ] The key and the token never appear in logs or errors. `GarminApiError` holds the path only, without headers.

**Tests:** `lib/garmin/client.test.ts` with a mocked `fetch`: first exchange, cached token reused, re-exchange on 401 (exactly once), 429 → `GarminRateLimited`, raw token vs JSON wrapper.

**Done when:** `bun test` passes; the probe uses `GarminClient` instead of its own fetch code.

---

### Step 2 — Schema `garmin_daily_wellness`

> [!note] The final column list comes from Step 0. Only fields with ≥50% coverage get a typed column; everything else stays in `raw`.

**Draft:**

```sql
CREATE TABLE IF NOT EXISTS runcoach.garmin_daily_wellness (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    text NOT NULL,
  day                        date NOT NULL,          -- by the rule fixed in Step 0 (likely: wake date)
  -- Body battery
  body_battery_high          smallint,
  body_battery_low           smallint,
  body_battery_at_wake       smallint,               -- the most useful one for readiness
  body_battery_charged       smallint,
  body_battery_drained       smallint,
  -- Stress (0-100)
  stress_avg                 smallint,
  stress_max                 smallint,
  -- Sleep
  sleep_secs                 int,
  sleep_deep_secs            int,
  sleep_light_secs           int,
  sleep_rem_secs             int,
  sleep_awake_secs           int,
  sleep_score                smallint,
  avg_sleep_hr               smallint,
  avg_sleep_respiration      numeric,
  avg_spo2                   numeric,
  -- HRV (Garmin's own definition — not mixed with daily_wellness.hrv unless D3 says so)
  hrv_last_night_avg         numeric,
  hrv_weekly_avg             numeric,
  hrv_baseline_low           numeric,
  hrv_baseline_high          numeric,
  hrv_status                 text,                   -- BALANCED / UNBALANCED / LOW / POOR, as returned
  resting_hr                 smallint,
  -- Provenance
  raw                        jsonb NOT NULL,         -- per-endpoint response for that day: {hrv:…, sleep:…, bb:…}
  synced_at                  timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz DEFAULT now(),
  UNIQUE (user_id, day)
);
ALTER TABLE runcoach.garmin_daily_wellness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.garmin_daily_wellness FROM anon;
CREATE INDEX ON runcoach.garmin_daily_wellness (user_id, day DESC);
```

- [ ] Apply via Supabase MCP to project **`tlnqkxwlrewbtufnqiwi`**, schema `runcoach` (never the deleted old project).
- [ ] `GarminDailyWellness` type in `lib/db/types.ts`.
- [ ] Upsert policy: **full row** (like intervals.icu wellness). Garmin recalculates the last few days (body battery, HRV status), so a newer read is better data. There is no athlete-authored content on the row.

---

### Step 3 — Mapper (pure, tested)

**Files:** `lib/ingest/garmin-wellness.ts`, `lib/ingest/garmin-wellness.test.ts`, `lib/ingest/__fixtures__/garmin/*.json`

```ts
export interface NormalizedGarminWellness { user_id: string; day: string; /* columns from Step 2 */ raw: unknown }

/** Combine per-endpoint responses into one row per day. */
export function toNormalizedGarminWellness(
  userId: string,
  parts: { hrv?: unknown[]; sleep?: unknown[]; bodyBattery?: unknown[]; summaries?: unknown[] },
): NormalizedGarminWellness[]

export function garminDayOf(...): string        // the day-attribution rule, in one place
export function secs(v: unknown): number | null  // absent / negative / NaN -> null
export function score(v: unknown, max = 100): number | null  // outside 0..max -> null, not clamped
```

**Rules:**
- [ ] One function for the day rule (`garminDayOf`), with a test that pins the night of 23→24 to the correct date.
- [ ] Units converted once: seconds in, seconds stored. Garmin sometimes gives ms (`*TimestampGMT`); convert to an ISO string.
- [ ] Out of range is **rejected (null)**, not clamped. A clamp would hide that Garmin changed a convention. Same reason as `toMetres`.
- [ ] Body battery at wake: take it from the sleep response (`bodyBatteryChange`/`wakeBodyBattery`, whatever Step 0 finds); otherwise null. Not computed from intraday data unless Step 0 shows a reliable field.
- [ ] Fixtures: cut from the probe output, **with all health values replaced** by synthetic values that keep the structure. Health data is never committed.

**Tests (at least):**
- [ ] A complete day → all columns.
- [ ] A day with no watch (no sleep) → sleep columns null, the row still exists if body battery exists.
- [ ] A day where the watch was off overnight → `hrv_*` null, not 0.
- [ ] A value outside 0..100 → null.
- [ ] Day attribution across midnight and DST (Israel summer/winter time: 2026-10-25 is close!).
- [ ] Two sources for the same day (sleep + daily summary) merge into one row.

---

### Step 4 — Sync and backfill

**Files:** `lib/garmin/sync.ts`, `app/api/cron/intervals-sync/route.ts` (one block), `app/api/intervals/sync/route.ts` (one block), `scripts/backfill-garmin-wellness.ts`, `lib/db/garmin-wellness.ts`

```ts
export const GARMIN_WELLNESS_DAYS_BACK = 14;   // Garmin recalculates recent days; 14 covers a late watch sync
export interface GarminSyncResult { daysUpserted: number; errors: string[]; skipped?: 'not_connected'|'cooldown'|'key_expired' }
export async function syncGarminWellnessForUser(userId: string, opts?: { daysBack?: number }): Promise<GarminSyncResult>
```

- [ ] Order: check the key's expiry date → `cooldown_until` → fetch (one range call per endpoint where Step 0 shows ranges are supported; otherwise per day within the limit) → map → upsert.
- [ ] **Cron:** after the intervals.icu block in `intervals-sync`, in a separate `try/catch`. The result goes into the same JSON response under `garmin`.
- [ ] **Sync-on-open:** in `/api/intervals/sync`, after the claim is taken, run the Garmin sync **in parallel** with intervals (`Promise.allSettled`), with `daysBack = 2`. Same debounce, no second claim system.
- [ ] Every user is synced through their own `garmin_tokens` row (there is one user, but the code must not assume it).
- [ ] `last_success_at` is written only on success; `last_error` is written on failure and cleared on success.
- [ ] **Backfill script:** `scripts/backfill-garmin-wellness.ts --from 2023-01-01 [--commit]`
  - dry-run by default: prints how many days, per-field coverage, and what it would write
  - chunks sized to the range limit from Step 0; a pause between calls; stops on a 429 and prints where to resume (`--from <date>`)
  - ends with an acceptance check: rows = days with any data, and a second run changes nothing (idempotence)

**Done when:** a manual cron run returns `garmin.daysUpserted > 0`; opening the dashboard twice within 30 minutes makes one Garmin call; the backfill fills N days and a second run changes nothing.

---

### Step 5 — Same-day freshness

> [!note] Most of it already exists
> sync-on-open (`claimAutoSync`, 30 minutes) already runs when the app opens. Once Step 4 adds Garmin to it, opening the dashboard in the morning after the watch syncs pulls in last night's data.

- [ ] Verify with Step 0's availability measurement that the data is there by the usual time the app is opened before a run.
- [ ] If not, a "Refresh recovery" button on the Recovery tile (calls `/api/intervals/sync` with `ifStaleMinutes=0` for Garmin only).
- [ ] `getLatestRecoveryReading` already handles "the newest row has no reading" (documented there), and continues to do so on the merged data.

---

### Step 6 — Readers: merge, coach, UI

**Files:** `lib/db/wellness.ts`, `lib/coach/readiness-service.ts`, `lib/rag/user-formatter.ts` (`formatRecovery`), `lib/coach/training-state.ts`, the dashboard Recovery tile, `lib/supervisor/preflight.ts`

**6a. Merge (`lib/db/wellness.ts`):**
- [ ] `getRecentWellness` / `getLatestRecoveryReading` return `DailyWellness & { garmin?: GarminDailyWellness | null; sources: Record<string, 'intervals'|'garmin'> }`.
- [ ] By D3: if the values agree, fill only nulls in `hrv`/`resting_hr`/`sleep_*` from Garmin, recording `sources.hrv = 'garmin'`.
- [ ] `hasWatchReading` also counts `garmin.body_battery_at_wake` / `garmin.sleep_secs`. Otherwise the Recovery tile shows "--" on a day only Garmin has.
- [ ] `getWellnessBaselines`: the HRV baseline is computed **only** from the source D3 chose. Add `bodyBatteryWakeMean/Sd` and `stressAvgMean`, under the same `MIN_BASELINE_SAMPLES = 10`.

**6b. Coach (`formatRecovery`):**
- [ ] New lines, for example:
  `Body battery at wake: 41 (your 28-day median 62, p10 38) · Stress avg 34 · Sleep 6.4h (deep 1.1h, REM 1.3h, awake 0.4h) · HRV status: UNBALANCED (weekly 48, baseline 52–68)`
- [ ] Always compared against **his own median**, never as an absolute number.
- [ ] A field that is absent is written as "not measured", never omitted silently.

**6c. `training-state.ts` `gaps[]`:**
- [ ] `garmin_not_connected` — only when the user has no row in `garmin_tokens`.
- [ ] `garmin_key_expiring` — 14 days or less before `key_expires_at`.
- [ ] `garmin_stale` — `last_success_at` more than 36 h ago.
- [ ] `garmin_no_reading_today` — after 10:00 IL with no row for today.

**6d. UI:**
- [ ] Recovery tile on the dashboard: body battery at wake (number + a sparkline of the last 14 days), stress, sleep stages as a stacked bar, the HRV status chip. "Not measured" for a missing value.
- [ ] No new colour/verdict until Step 7.

**6e. Preflight:**
- [ ] An expired key / `garmin_stale` → `warn` (counted in Coach Health). "Not connected" → `info`.

**Done when:** `bun test` passes, `bun run build` passes, `scripts/qa-smoke.ts` shows the new lines, and Ask Coach for "how did I recover last night?" answers with the body battery number and its comparison to his median (check it in `coach_calls`).

---

### Step 7 — Readiness rules (≥4 weeks of data, or immediately if the backfill gives a year)

> [!warning] Measure before setting a threshold
> CLAUDE.md records three times that generalising from one observation is this codebase's most persistent error. A threshold is placed against the **distribution** of his data, and validated against the days on which he actually ran badly.

- [ ] Script: `scripts/measure-garmin-readiness.ts` (read-only): the distribution of `body_battery_at_wake` / `stress_avg` / `sleep_deep_secs` (min, p10, p25, median, p75, p90), and their relationship to:
  - post-run `run_feedback` (rating / effort / feeling) the next day
  - aerobic decoupling percentile on that day's run
  - quality sessions that were not completed
- [ ] Candidate rule (not before measuring): `body_battery_at_wake < his own p10` **and** (HRV below baseline **or** short sleep) → caps the verdict at **EASY**. Never REST on a single signal.
- [ ] A rule is gated on both the reading and the baseline existing, exactly like the existing HRV rule. Missing → the rule is skipped, never assumed.
- [ ] Unit tests in `lib/utils/readiness.test.ts` that pin: an ordinary day with low body battery and normal HRV → not EASY.
- [ ] Add the reasoning to the CLAUDE.md "Readiness verdict" section.

---

### Step 8 — Make failure loud

> [!danger] A source that expires and fails silently
> The RAG layer was dead for months because it failed soft. A key that expires once a year will break the same way unless something checks.

- [ ] **Weekly health audit** (`/api/cron/weekly-health-audit`): a Garmin section — last success, coverage over 7/28 days, days until the key expires (⚠️ at 14 or fewer, 🔴 when expired).
- [ ] **Preflight:** as in 6e.
- [ ] **`scripts/qa-smoke.ts`:** `check('garmin token exchange', …)`, `check('garmin wellness today or yesterday', …)`, `check('garmin key > 14d to expiry', …)`.
- [ ] **CoachHealthWidget:** a "Garmin feed" row (last success + expiry).
- [ ] Calendar: when the key is created, add a Google Calendar event 14 days before it expires, "Rotate Garmin Personal API key" (optional, with your approval).

---

### Step 9 — Connection UI

**Files:** `app/coach/settings/page.tsx`, `app/api/garmin/connect/route.ts` (POST/DELETE), `app/api/garmin/status/route.ts` (GET)

- [ ] A "Garmin Connect (Personal API)" card: a key field (password type), expiry date (default: today + 365), a **Test & Save** button.
- [ ] `POST /api/garmin/connect`: Zod (`lib/validation/schemas.ts`), one token exchange to verify, encrypt, upsert into `garmin_tokens`, and immediately a 14-day sync. The key is never returned to the client.
- [ ] `DELETE`: deletes the token row. Wellness data is kept (the same disarm-not-delete principle as Strava).
- [ ] `GET /api/garmin/status`: connected? `key_expires_at`, `last_success_at`, `last_error`, coverage over 7 days.
- [ ] Key rotation = paste a new key into the same card, which replaces the row.
- [ ] Copy that explains: "Read-only. RunCoach cannot change anything in your Garmin account. Workouts still go to the watch through intervals.icu."

---

## 5. Open questions

- [ ] **Terms of the Personal API.** The coach prompts send wellness to OpenRouter / NanoGPT. Check in the T&C you accept when creating the key whether passing data to third parties is allowed. One write-up mentions such a restriction for licensees; unverified for the Personal tier. **If forbidden:** Garmin data drives only code (Step 7), and 6b is dropped.
- [ ] **Encryption key name.** `INTERVALS_TOKEN_KEY` serves both. Rename it to `TOKEN_ENCRYPTION_KEY` with a fallback? (Recommended: leave it as is now, separate change later.)
- [ ] **FIT files.** In future, a backup source for activities when intervals.icu is down? Out of scope for this plan; noted only.
- [ ] **Weight / fitness age.** Not relevant to readiness. CalTrack already has weight; connecting them is a separate question.

## 6. Risks

| risk | effect | mitigation |
|---|---|---|
| Garmin changes the API (new, young product) | sync breaks | errors recorded, `garmin_stale` in gaps, health audit |
| Key expires | silent breakage | Step 8 + Garmin's email + calendar event |
| Wrong day attribution | the HRV two-days-running rule fires on the wrong pair | `garminDayOf` with tests, measured in Step 0 |
| Mixed HRV definitions | a meaningless baseline | D3: no merge without measured agreement |
| Undocumented rate limit | 429 during the backfill | `cooldown_until`, a resumable backfill |
| Health data in git | leak | `garmin-probe/` gitignored, synthetic fixtures |
| Terms forbid LLM use | breach | §5 before Step 6b |

## 7. Order, PRs and estimates

| PR | steps | depends on | size |
|---|---|---|---|
| — | 0 probe + findings | your key | ~2–3 h |
| PR 1 | 1 client + 2 schema + 3 mapper + 4 sync/backfill + 5 freshness + 8 monitoring | Step 0 go | medium (~1 day) |
| PR 2 | 6 readers/coach/UI + 9 connect UI | PR 1, terms | medium (~1 day) |
| PR 3 | 7 readiness rules | ≥4 weeks or a backfill | small, after measuring |

Every PR: `bun test`, `bun run build`, `scripts/qa-smoke.ts`, and a CLAUDE.md update (a "Garmin Personal API" section in the style of the existing ones).

## 8. Links

- Garmin Personal API: https://developer.garmin.com/gc-developer-program/personal/personal-api
- Garmin FAQ: https://developer.garmin.com/gc-developer-program/personal/personal-faq/
- Endpoint probe: https://github.com/tamcore/garmin-mcp/issues/42
- DC Rainmaker (tiers): https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html
- Tredict (read-only, no push): https://www.tredict.com/blog/garmin_personal_api_chatgpt_and_claude/
- In the repo: `scripts/probe-garmin-personal.ts`, `lib/db/wellness.ts`, `lib/utils/readiness.ts`, `lib/intervals/sync.ts`, `docs/intervals-icu-probe-findings.md`
