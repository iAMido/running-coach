---
title: Garmin Personal API — probe findings
project: RunCoach
created: 2026-10-24
tags: [runcoach, garmin, wellness, probe]
---

# Garmin Personal API — probe findings (2026-10-24)

Step 0 of [[garmin-wellness-plan]]. Measured with `scripts/probe-garmin-personal.ts --days 60` (window 2026-08-25 .. 2026-10-24) against the athlete's own account, plus a read-only query of `runcoach.daily_wellness` for the same window.

> [!success] Decision: GO
> The criterion was "body battery **or** sleep stages on ≥80% of days". Both are present on **100%** (body battery 61/61 days in daily summaries and 28/28 in the reports endpoint; sleep stages 30/30 nights checked).

## Auth

- `POST /personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>` only. **Adding `Accept: application/json` returns 406** (`NotAcceptableException`). A wrong key returns 401.
- The token is a ~1,141-char string. Data calls use `Authorization: Bearer <token>`, `Accept: */*`.

## What each endpoint gave

| endpoint | range in one call | coverage | notes |
|---|---|---|---|
| `hrv-service/hrv/daily/{from}/{to}` | ✅ 60 days | **61/61** | `lastNightAvg`, `weeklyAvg`, `lastNight5MinHigh`, `status`, `feedbackPhrase`, `baseline.{lowUpper, balancedLow, balancedUpper, markerValue}` |
| `usersummary-service/v2/dailysummaries?startDate&endDate` | ✅ 60 days | **61/61** | resting/min/max HR; **stress** avg/max/qualifier + low/med/high/rest proportions and durations; **body battery** min/max/charged/drained/latest + feedback events + activity events; **respiration** avg/min/max; steps, floors, intensity minutes, calories. SpO2 **46/61**. Hydration 19/61 (not used). |
| `wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate` | ❌ 60 days → 400; ✅ **28 days** | **28/28** | `charged`, `drained`, **`bodyBatteryValuesArray`** (intraday), feedback events with level + timestamp. **Maximum range is between 28 and 59 days**: fetch in 28-day chunks. |
| `sleep-service/sleep/dailySleep?date=` | one night per call | **30/30**, 0 failures | stages (deep/light/REM/awake/unmeasurable), `sleepScores.*` (overall + 7 components), `avgHeartRate`, SpO2 avg/low/high, respiration avg/low/high, `avgSleepStress`, `awakeCount`, `sleepNeed.*` (incl. `hrvAdjustment`, `trainingFeedback`), `sleepAlignment.*`. `autoSleep*`, `sleepQualityTypePK`, `sleepResultTypePK`: 0/30 (absent; ignore). |
| `sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate` | ❌ 400 | — | Parameter names unknown. Check the Swagger "Parameters" panel. Until then sleep costs one call per night. |
| `usersummary-service/stats/stress/daily/{s}/{e}` | ❌ 400 at 60 days | — | Not needed: stress is in v2 daily summaries. |
| `biometric-service/heartRateZones/v2` | ✅ | — | Garmin's zones: `trainingMethod`, `lactateThresholdHeartRateUsed`, `maxHeartRateUsed`, zone floors. Relevant to the LTHR 165-vs-173 note in CLAUDE.md; not part of this plan. |
| `activitylist-service/.../search/activities?startDate&endDate&start&limit=50` | — | 20 returned | Looks like a 20-per-page cap. Not used for wellness. |
| activity summary | — | — | `avgGradeAdjustedSpeed` (m/s) **is** present; cadence is true spm (159). Not used: intervals.icu stays the activity source. |
| FIT download | — | ✅ 115 KB zip | Not used now. |

## Overlap with intervals.icu (`runcoach.daily_wellness`, same 61 days)

| field | intervals.icu | Garmin |
|---|---|---|
| hrv | **61/61** | 61/61 (`lastNightAvg`) |
| resting_hr | **61/61** | 61/61 (`heartRate.restingValue`) |
| sleep_secs | **61/61** | 30/30 checked |
| sleep_score | **61/61** | 30/30 checked |

> [!important] Consequence for the plan (D3)
> intervals.icu currently has **no gaps** on the overlapping fields in this window (the ~12% HRV absence was over a full year). Gap-filling is therefore not a reason to merge. **Decision: no merging.** intervals.icu keeps `hrv` / `resting_hr` / `sleep_secs` / `sleep_score` as the only source for those values. Garmin contributes **only fields intervals.icu does not have.** That removes the riskiest part of the plan (two HRV definitions in one baseline).
>
> ✅ Checked (see below): identical. Original note: whether Garmin's `lastNightAvg` equals intervals.icu's `hrv` on the same calendar date. It matters because Garmin's HRV **status and baseline band** are computed on Garmin's number. If the two differ by a day, the coach would see a "LOW" status next to an HRV value from another night. The probe's `--compare` mode prints the table for this.

## Fields the integration will store

Garmin-only, all at ≥75% coverage:

- **Body battery:** min, max, charged, drained, latest; **value at wake**, derived from `bodyBatteryValuesArray` at `sleepEndTimestampGMT` (the daily summary has no at-wake field)
- **Stress:** avg, max, qualifier, high-stress duration
- **Sleep:** deep, light, REM, awake secs; awake count; avg sleep stress; sleep-score components; `sleepNeed.actual` vs `baseline`
- **HRV context:** `status`, `weeklyAvg`, `baseline.balancedLow/Upper`
- **Night physiology:** avg sleeping HR, respiration avg, SpO2 avg (SpO2 46/61, nullable)

## Still open

- [x] `--compare` (2026-10-24, 14 days 10-11..10-24): **identical on 14/14 days for all four fields**: HRV, resting HR, sleep hours (to 0.01 h), sleep score. Both sources file the night under the **wake date** (e.g. sleep 10-23 00:34 → 07:14 is `2026-10-23`). The two sources are the same Garmin numbers, so Garmin's HRV `status` / `baseline` band sits next to the correct value with no conversion.
- [ ] Parameters for `dailySleepSummariesByDate` (from Swagger). Without them a 1-year backfill means 365 sleep calls.
- [ ] Rate limit: 30 sequential sleep calls at 250 ms spacing gave no 429. A year-long backfill is untested.
- [ ] History depth: run with `--days 365`.
- [ ] Availability time: when last night's data appears (06:30 / 08:00 / 10:00 IL).
- [ ] Whether a 0 is a real value or a placeholder: coverage counted 0 as present. The mapper will check per field (body battery 0, stress -1/-2 are Garmin's "not measured" markers in other APIs).

## History import and step 7 measurement (2026-10-24, 731 days)

**Coverage, 2024-10-24 → 2026-10-24:** sleep, stages, stress, daily body battery and HRV status on ~97% of days (2026-Q1 is lower: sleep 69/90, HRV 66/90 — likely watch off). History reaches back at least 2 years, so the "whole history" claim held.

**Body battery at wake cannot be recovered for history.** The "intraday" series from `bodyBattery/reports/daily` is only **6 points per day**, even for recent dates. Before ~April 2026 those 6 points have **null levels and placeholder timestamps** (`…001` … `…006` ms). So `body_battery_at_wake` exists only from 2026-Q2, and only when one of the 6 points falls within 30 min of waking.

**The daily peak is the morning value.** On the 136 days carrying both, `body_battery_max` equals the at-wake value on **129 (95%)** and is within 3 points on 135. Body battery tops out at waking. The readers therefore use `body_battery_max` from the newest *completed* night (before waking, today's peak is still the overnight low).

**His distribution (725 complete days):** morning body battery p5 65 · p10 71 · p25 79 · median 88 · p75 95 · min 25. All-day stress median 24, p90 29. Median deep sleep 49 min.

**Does a low morning body battery go with worse runs? Not measurably — and too few outcomes to tell.**

| morning body battery | runs | median decoupling, steady runs | easy-run EF ×1000 | runs with feedback |
|---|---|---|---|---|
| < 71 (p10) | 32 | 6.5% (n=3) | 17.06 (n=4) | 1 |
| 71–78 | 37 | 5.4% (n=7) | 17.42 (n=4) | 1 |
| 79–94 | 138 | 6.0% (n=42) | 17.32 (n=40) | 17 |
| ≥ 95 | 97 | 7.7% (n=16) | 17.62 (n=21) | 13 |

> [!important] Step 7 decision: no readiness rule yet
> A threshold in the low band would rest on 3–4 runs and 1 feedback entry, the generalise-from-too-little error CLAUDE.md records repeatedly. The bottleneck is **outcomes, not Garmin data**: 32 feedback entries in two years. Revisit when the < p10 band has ≥15 runs with feedback or computed decoupling. The coach already sees the number against his own range (step 6), and that is as far as the evidence goes.
