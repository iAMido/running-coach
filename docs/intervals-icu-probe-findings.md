# intervals.icu — probe findings (2026-08-05)

Read-only reconnaissance against the live account before committing to a migration
off Strava. No writes were made to intervals.icu; no app code was changed.

## Verdict

**Go.** No functional regression. Every field the app depends on today is available,
several are better, and the recovery layer is new. The real work is migration
hygiene, not integration.

---

## 1. Connectivity and auth — confirmed

| Item | Result |
|---|---|
| Base URL | `https://intervals.icu/api/v1` |
| Auth | HTTP Basic, username is the **literal string** `API_KEY`, password is the key |
| User-Agent | **Must be custom.** Cloudflare 403s the default `python-requests`/`node-fetch` UA |
| Reachable from Vercel-style Node runtime | Yes — plain HTTPS, no native deps |

Wrong UA → mystery `403` on a perfectly valid key. This cost the community prompt
authors enough pain that they called it out; it's real.

## 2. Account inventory

- **134 activities** in the last 400 days; **117 runs**
- Date range **2025-08-05 → 2026-08-03**
- Source: `GARMIN_CONNECT` on 117/117, `file_type: fit`
- Devices: Forerunner 970 (79), Forerunner 255 (36)
- **`strava_id` is null on 117/117** — data comes straight from Garmin, never
  touching Strava. This is the clean path w.r.t. the Strava API agreement.

## 3. Field coverage vs. the `runs` table

Every column maps. Fill rates across 117 runs:

| `runs` column | intervals.icu source | Fill |
|---|---|---|
| `distance_km` | `distance` (m) | 117/117 |
| `duration_min` | `moving_time` (s) | 117/117 |
| `avg_hr` / `max_hr` | `average_heartrate` / `max_heartrate` | 116/117 |
| `avg_pace_min_km` | `average_speed` (m/s) | 117/117 |
| `calories` | `calories` | 117/117 |
| `workout_name` | `name` | 117/117 |
| `trimp` | `trimp` (**precomputed**) | 116/117 |
| `pct_z1..pct_z6` | `icu_hr_zone_times` | **115/117** |

### Newly available, no equivalent in the current schema

`gap` (grade-adjusted pace), `icu_intensity`, `icu_training_load`, `session_rpe`,
`lthr`, `athlete_max_hr`, `icu_hr_zones` (live zone boundaries), `icu_ctl`/`icu_atl`
per activity, `polarization_index`, plus full running dynamics — stance time,
vertical oscillation, step length, leg spring stiffness, impact loading rate.

## 4. The regression risk — resolved

This was the blocker. Both endpoints work.

**HR streams** — `GET /activity/{id}/streams?types=heartrate,time`
Returns per-second arrays. Test activity: **5,418 points**. `computeZonePercentsFromStream`
works unchanged.

**Laps** — `GET /activity/{id}/intervals`
Returns `icu_intervals[]`. Test activity: **16 entries**, each carrying
`moving_time`, `distance`, `average_heartrate`, `max_heartrate`, `min_heartrate`,
`average_speed`, `gap`, `intensity`, `type` (`WORK`/`RECOVERY`), `start_time`.

That is a **superset** of the current `laps` table. Strava never provided
`intensity`, `gap`, `min_heartrate`, or WORK/RECOVERY classification — all four
directly improve the per-rep interval commentary in the weekly review prompt.

### ⚠️ CORRECTION — do NOT use `icu_hr_zone_times`

An earlier draft of this document recommended deriving `pct_z1..pct_z6` straight
from `icu_hr_zone_times` to save an API call per run. **That recommendation was
wrong and has been withdrawn.** The two systems do not agree on what a zone is:

| | Z1 | Z2 | Z3 | Z4 | Z5 | Z6 | Z7 | max HR | LTHR |
|---|---|---|---|---|---|---|---|---|---|
| `athlete_profile` | 0–120 | 120–138 | 138–150 | 150–162 | 162–175 | 175–185 | — | 185 | 165 |
| intervals.icu | ≤146 | 146–154 | 154–163 | 163–172 | 172–177 | 177–182 | 182–191 | 191 | 173 |

The app calls Z4 `150–162`; intervals.icu calls it `163–172`. Ingesting
`icu_hr_zone_times` would silently redefine "Z4" partway through the history —
breaking `yesterdayHardPct` in `lib/utils/readiness.ts` (which thresholds on
`pct_z4+z5+z6 > 40`), the `Intervals` branch in `classifyRun`, and every
zone-based statement the coach has ever made about a past run.

**Correct approach:** fetch `/activity/{id}/streams?types=heartrate,time` and run
the existing `computeZonePercentsFromStream(hr, time, parseZonesFromProfile(profile))`.
This keeps one zone definition — the athlete's — across all 666 runs. It costs one
extra API call per new run, which is irrelevant against a 5,000/day limit.

The 7-vs-6 zone count question dissolves: it never arises if `icu_hr_zone_times`
is not used.

> **RESOLVED 2026-08-05.** Max HR is **191**, threshold HR **173**, already updated
> on Garmin and therefore live in intervals.icu. `runcoach.athlete_profile` is still
> on the old `185`/`165` and must be updated to match — see Phase 2b of the
> implementation spec.
>
> Decision: **no historical recompute.** The ~660 existing runs keep their
> old-zone `pct_z1..pct_z6`. New zones apply going forward only. This is a
> deliberate, documented discontinuity at the cutover date, not a bug.
>
> Evidence behind 191: peaks of 205 / 202 / 201 / 197 and a 195 on an *easy 6 km*
> are artifacts — 33–50 bpm gaps between average and peak are strap dropouts or
> cadence lock. The credible cluster is 191–195, anchored by a 2023 half marathon
> at 195 peak / 172 average (spread 23). 191 is the conservative end of that range
> and keeps the app aligned with Garmin and intervals.icu, which is worth more than
> the last 4 bpm.

## 5. Wellness — genuinely new capability

366 days returned. Fill rates:

| Field | Last 365d | Last 60d |
|---|---|---|
| `ctl` (fitness) / `atl` (fatigue) | 100% | 100% |
| `restingHR` | 99% | 100% |
| `steps` | 99% | 100% |
| `sleepSecs` / `sleepScore` | 93% | 98% |
| **`hrv`** | **88%** | **100%** |
| `vo2max` | 30% | 46% |
| `weight` | 8% | 44% |

Current state: **Fitness 17.7 · Fatigue 18.6 · Form −0.9**

### Not available through intervals.icu

`bodyBattery`, `readiness`, `stress`, `respiration`, `spO2`, `avgSleepingHR` are
**all zero across 366 days**. These are Garmin-native composite scores that do not
propagate. Going Garmin-direct would get them; intervals.icu will not.

Assessment: acceptable. HRV, sleep and resting HR are the substantive physiological
inputs. Body Battery and Training Readiness are Garmin's own opinion, and
`lib/utils/readiness.ts` computes its own verdict anyway.

## 6. Migration hazards — the actual work

### 6a. The app is already dark

`runcoach.runs` latest row is **2026-06-29**. intervals.icu has runs through
**2026-08-03**. The Strava sync stopped ~5 weeks ago.

**19 runs are missing from the database**, including sessions the coach would care
about most:

```
2025-09-03   9.01 km  Running
2025-09-17   2.78 km  Running WU
2026-07-02   5.14 km  Running
2026-07-05   5.06 km  Easy Run
2026-07-06   5.53 km  Easy Run
2026-07-08   4.22 km  Easy Run
2026-07-11  10.03 km  Running
2026-07-13   6.55 km  Fartlek
2026-07-15   4.63 km  Easy Run
2026-07-17  10.95 km  Long Run
2026-07-19   4.59 km  Easy Run
2026-07-20   7.42 km  Tempo
2026-07-22   4.93 km  Easy Run
2026-07-25  11.73 km  Long Run
2026-07-27   4.73 km  Easy Run
2026-07-29   4.19 km  Easy Run
2026-08-01   8.75 km  Long Run
2026-08-02   5.30 km  Running
2026-08-03   9.23 km  Threshold Intervals
```

Everything the coach has said for five weeks was reasoned without a Fartlek, a
Tempo, three Long Runs and a Threshold Intervals session.

### 6b. Duplicates — 19 pairs, in three categories (revised)

An earlier draft said "7 duplicate pairs, delete the newer of each". **That was
wrong on both the count and the remedy.** A proper matcher (±3h, ±2% distance)
finds **19 pairs**, and `run_feedback.run_id` and `laps.run_id` are both
`ON DELETE CASCADE` — so a careless delete silently destroys laps and feedback.

**Category A — one true exact duplicate. RESOLVED, deleted 2026-08-05.**
`2022-09-10` 8.45 km, same `filename`, identical in every column, inserted twice
46 seconds apart.

**Category B — two empty `fit_upload` rows. RESOLVED, deleted 2026-08-05.**
`2025-12-31` and `2026-01-02`: the `fit_upload` copy had no zones, no laps and no
coach notes, while its `strava_sync` twin had 11–12 laps plus notes. Nothing unique
was lost.

**Category C — 6 garmin↔strava pairs. NOT deleted. These need a MERGE.**
`2025-12-15`, `12-18`, `12-20`, `12-22`, `12-26`, `12-29`. Each pair is the same run
ingested twice, exactly **2.00 hours apart** (Asia/Jerusalem UTC+2 stored
inconsistently — the `garmin` rows hold true UTC, the `strava_sync` rows hold local
time in a UTC-typed column). Neither copy is strictly better:

| copy | has zones | has laps | has coach_notes |
|---|---|---|---|
| `garmin` (`.fit`) | ✅ | ❌ 0 | ❌ |
| `strava_sync` | ❌ | ✅ 9–21 | ✅ |

Deleting either loses real data. The fix is to merge zones from the `garmin` row
onto the `strava_sync` row, then delete the `garmin` row — but this belongs in a
tested script, not an ad-hoc SQL statement.

**Category D — 10 ambiguous 2022 pairs. Left alone, low priority.**
`2022-11-07` through `2022-12-02`. Same timestamp ±9s, distances differing by
0.01–0.12 km, **different `filename`s** (different Garmin activity IDs). Could be a
watch+phone double-record or a split/resumed activity. Both copies carry zones,
neither carries laps or feedback. They inflate 2022 volume totals but have no
bearing on current coaching. Decide separately.

**Backup:** all 38 involved rows, their 114 laps and 0 feedback rows were snapshotted
to `runcoach._bak_20260805_runs` / `_bak_20260805_laps` / `_bak_20260805_feedback`
before any deletion. Restore is a plain `insert into ... select from`.

Run count: **669 → 666.**

### 6c. Overlap is clean — no fuzzy horror

Of 117 intervals.icu runs matched against the DB on `(date, distance ±2%)`:

- **98 already present** → update in place, do not insert
- **19 new** → insert
- **11 DB rows since 2025-08-01 with no counterpart** → pre-Garmin or manual
  uploads; leave alone

The matcher is reliable. `strava_id` being null means there is no ID shortcut, but
date+distance is unambiguous at this volume.

### 6d. Do not re-key existing rows

`run_feedback` links by `run_id` (27 rows, 26 currently linked, 1 already orphaned).
The backfill must **UPDATE** the 98 matched rows and preserve their `id`. Insert-and-
replace orphans the feedback, which silently empties the coach's context via
`user-formatter`.

Only 50 of 669 runs have laps today. Backfilling `icu_intervals` across the last
year is a large, free upgrade to the RAG context.

### 6e. Two fatigue models

`trimp` is precomputed by intervals.icu on 116/117 runs; the app computes its own
via `lib/utils/trimp.ts` on all 669. Adopting theirs creates a discontinuity at the
migration date in a series `readiness.ts` reads. Recommendation: keep the local
TRIMP as the authoritative series, store `icu_training_load` alongside as a
cross-check, and revisit later.

## 7. Not yet tested

- **Write-back** (`POST /athlete/{id}/events`) — deliberately untested, no writes to
  a live account without sign-off. The zone-suffix trap is documented and needs
  respecting: the event `target` field is ignored; only the description suffix
  decides. `Z2` = power, `Z2 HR` = heart rate, `Z2 Pace` = pace. Bare `Z2` on a run
  silently produces watts.
- **OAuth app registration** — API key works today and is fine for single-user.
  OAuth is required before any second athlete.
- **Webhooks** — would replace the twice-daily cron with push.

## 8. Recommended order

1. Delete the 7 duplicate pairs.
2. Extract per-activity mapping out of the two Strava sync routes into
   `lib/ingest/upsert-run.ts` — currently duplicated, and a third copy would be worse.
3. Build `/api/cron/intervals-sync`. Derive zones from `icu_hr_zone_times`; fetch
   `/intervals` for laps. Match on `(date, distance ±2%)` → UPDATE, else INSERT.
   Preserve `id` on matched rows.
4. Backfill the 19 missing runs and the last year of laps.
5. `runcoach.daily_wellness` table + ingest.
6. Wire HRV and sleep into `computeReadiness` and `user-formatter`. Without this the
   pipeline is plumbing to nowhere.
7. Leave Strava code in place, crons disabled, until verified.
8. Write-back as a separate phase.
