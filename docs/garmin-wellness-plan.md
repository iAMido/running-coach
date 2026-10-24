# Garmin Personal API → wellness — implementation plan

Status: **plan, nothing built** beyond the read-only probe (`scripts/probe-garmin-personal.ts`). Drafted 2026-10-24.

## Scope

Add Garmin's official Personal API as a **second wellness source, alongside intervals.icu — not a replacement.**

intervals.icu stays the owner of activities, laps, HR streams, GAP, CTL/ATL and the workout push to the watch. The Personal API is read-only and pull-only: it cannot push workouts, it has no laps or streams outside the FIT file, and as far as is known it has no CTL/ATL. Moving activities to it would mean losing the watch push and rebuilding lap segmentation on new definitions.

What it adds is Garmin's own recovery data. `lib/intervals/types.ts` records body battery, readiness, stress, respiration, SpO2 and average sleeping HR as **empty on all 366 days probed** from intervals.icu. That gap is the reason to do this.

Not available on the Personal API at all: training readiness and training status (`metrics-service` is not on its allowlist). Do not plan around them.

## Known facts vs assumptions

| | source |
|---|---|
| Token: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`, header `Authorization: ApiKey <key>` | Garmin's page (confirmed) |
| Key shown once; expires after 30 / 90 / 180 / 365 days; no refresh token; access token lasts 24 h | Garmin FAQ |
| 26 GET endpoints: HRV, sleep, body battery, daily summaries, activities, FIT download, weight, HR zones | third-party probe (tamcore/garmin-mcp#42) |
| Query parameters, date formats, maximum range per call, rate limits | **unknown** — the probe has to find out |
| Whether Garmin's HRV / resting HR / sleep match what intervals.icu stores | **unknown** — Step 0 |

## Step 0 — Measure before building (decision gate)

Run the probe against real data and write `docs/garmin-personal-probe-findings.md`, in the same shape as `intervals-icu-probe-findings.md`. Answer:

1. **Which fields actually come back, and how often**, over at least 60 days: body battery (high, low, charged, drained, and the value at wake), stress average, sleep stages (deep / light / REM / awake), average sleeping HR, respiration, SpO2, HRV status with its weekly average and baseline band. Count the days each field is present, the same way the 366-day intervals.icu probe did.
2. **Agreement on the fields both sources have.** Compare Garmin's `hrv`, `resting_hr`, `sleep_secs` and `sleep_score` against `runcoach.daily_wellness` day by day. Expected: identical, since intervals.icu receives these from Garmin. If they differ, find out why (day attribution, or a different HRV definition) before any reader combines them.
3. **Which day a reading belongs to.** Garmin may file the night's sleep and HRV under the wake date while intervals.icu files it differently. An off-by-one here breaks the two-days-running HRV rule in `readiness.ts`.
4. **When the data appears.** What time Israel time is last night's data available after the watch syncs? This decides Step 5.
5. **Limits:** the largest date range a single call accepts, and whether a 365-day backfill gets a 429.

**Gate:** continue only if at least body battery or sleep stages come back on ≥80% of days. If the only new fields are ones intervals.icu already has, stop here: a second copy of the same numbers is not worth maintaining.

## Step 1 — Credentials and client

- Migration: `runcoach.garmin_tokens`, using the RLS pattern from `20260805_intervals_icu.sql` (RLS on, no policies, anon revoked). Columns: `user_id` (unique), `api_key` stored **encrypted** with `lib/intervals/crypto.ts` (a key that reads all your health data is as sensitive as the intervals.icu key, and the service role bypasses RLS), `key_expires_at` (entered at connect time, because the API may not report it), `access_token`, `access_token_expires_at`, `last_sync_at`, `last_error`.
- `lib/garmin/client.ts`: exchange the key for a token, cache the token until 1 h before it expires, exchange again once on a 401, and back off on 429 (store the cooldown so the next run respects it).
- Env: none required. The key lives in the table, encrypted with the existing `INTERVALS_TOKEN_KEY` (rename it to a generic name later if that is wanted).

## Step 2 — Schema: a separate table

`runcoach.garmin_daily_wellness (user_id, day)` unique. Typed columns only for fields Step 0 showed are present, plus `raw jsonb` and `synced_at`.

**Not new columns on `daily_wellness`.** `upsertWellnessDays` overwrites the full row by design, because intervals.icu recomputes CTL/ATL retroactively. If Garmin values were stored in `hrv` or `sleep_secs` there, the next intervals.icu sync would replace them, often with nulls. A separate table also keeps provenance clean; `runs.data_source` shows the cost of losing it.

## Step 3 — Mapper (pure, tested)

`lib/ingest/garmin-wellness.ts`: Garmin response(s) → `NormalizedGarminWellness`. Tests use fixtures cut down from the probe output, **with health values replaced** before anything is committed.

Rules to state in code, not leave implicit:
- Units are converted once at ingest (seconds, bpm, whole numbers for scores), as `toCadenceSpm` and the pace conversions already do.
- Timestamps: Garmin returns both GMT and local times. The day attribution found in Step 0.3 goes into one function with a test.
- Absent is null, never 0. A body battery of 0 would read as total exhaustion.

## Step 4 — Sync

- `lib/garmin/sync.ts`: pulls the last 14 days (reaching back covers late watch syncs and Garmin recalculating values), then upserts.
- **No new cron.** Call it from the existing `/api/cron/intervals-sync` as a separate best-effort block, just as wellness is already separate from the activity loop: a Garmin failure is recorded in `errors[]` and never fails the intervals.icu sync. The project already has 4 Hobby crons and the 4th has not been confirmed to register.
- `scripts/backfill-garmin-wellness.ts`: one-off history import, split into chunks sized by the range limit found in Step 0.5. It is what gives the baselines in Step 7 enough data.

## Step 5 — Same-day freshness (only if Step 0.4 says it is needed)

The crons run at 15:00 and 21:40 UTC, so this morning's body battery would not arrive until the afternoon, after the run it is meant to inform. That is the same failure `getLatestRecoveryReading` documents for the 00:40 row. Options, in order of preference:
1. Refresh on demand: when `readinessForUser` finds no Garmin row for today and the last attempt was over 60 minutes ago, fetch today only, with a short timeout. Pull-only makes this cheap, and a failure falls back silently to what is already stored.
2. A "Refresh recovery" button on the dashboard.

Decide after measuring when the data actually appears.

## Step 6 — Readers: information first, no verdicts yet

- `lib/db/wellness.ts` is the only place that merges the two tables. Readers never query `garmin_daily_wellness` directly.
- Ownership rule, settled by Step 0.2:
  - The values agree → intervals.icu stays the source for `hrv` / `resting_hr` / `sleep_*`; Garmin only fills days intervals.icu is missing (HRV is absent about 12% of the year today). Each merged reading records which source it came from.
  - The values disagree → nothing is merged. The HRV baseline must come from a single definition. Mixing two is how decoupling and zones were corrupted before.
- `formatRecovery` in `lib/rag/user-formatter.ts` adds body battery at wake, stress and sleep stages to the coach's context as **observations**.
- `training-state.ts` `gaps[]`: "Garmin recovery not connected", "Garmin key expires in N days", and "no Garmin reading for today", so the coach can tell a missing feed from a good morning.
- The dashboard Recovery tile shows the new values.

## Step 7 — Readiness rules (later; needs ≥4 weeks of data)

Do not adopt Garmin's own thresholds (for example "body battery < 25 = rest"), for the same reason Friel's decoupling bands were rejected: they were calibrated on other people. Once enough history exists, place any new rule against **his own distribution**, the way `CLIMB_BANDS` was. A candidate: wake body battery below his own p10 caps the verdict at EASY. Check it against the days he actually ran badly before it is allowed to return REST. Measure the window, not one bad morning.

## Step 8 — Make failure loud

This is a pull-only source with a key that expires, so it will eventually break silently unless something checks.
- Weekly health audit: last successful Garmin sync, days of coverage, and days until the key expires (warn from 14 days out; Garmin's own email comes 7 days before).
- Supervisor preflight: an expired or failing Garmin key is a `warn`, not `info`.
- `scripts/qa-smoke.ts`: one read-only check (token exchange plus one day of data).

## Step 9 — Connect UI

Add a Garmin card to `/coach/settings`: paste the key, choose its expiry, test it (one token exchange), and show the status and expiry date. No OAuth, since the Personal API has none.

## Open question to settle before Step 6 — the terms

Coach prompts send wellness data to OpenRouter / NanoGPT model providers. Read the Personal API terms you accepted when creating the key for any limit on passing Garmin data to third parties. One write-up mentions such a restriction for licensees; that is unverified for the Personal tier. If the terms forbid it, Garmin data can still drive the readiness rules in code (Step 7) but must not enter prompts (Step 6).

## Order and size

| step | depends on | size |
|---|---|---|
| 0 probe + findings | your key | ~1 h incl. analysis |
| 1 credentials/client | 0 gate | small |
| 2 schema | 0 (field list) | small |
| 3 mapper + tests | 0 fixtures | small |
| 4 sync + backfill | 1-3 | medium |
| 5 freshness | 0.4 | small, maybe skipped |
| 6 readers + UI | 4, terms | medium |
| 7 rules | ≥4 weeks of data | small, later |
| 8 monitoring | 4 | small |
| 9 connect UI | 1 | small |

Steps 1-4 and 8 can ship together as one PR. 6 and 9 as a second. 7 comes weeks later.
