# What changed — August 2026

A plain-language summary of the intervals.icu migration and the analysis work
that followed. Written 2026-08-09.

---

## Where it started

Strava changed its API agreement in 2026. Two clauses matter: third-party apps
may no longer display a user's data to anyone but that user, and Strava data may
not be used "in connection with the development, training, evaluation, or
operation of any AI Application." RunCoach pipes runs into Claude and Grok
prompts, which is squarely the second clause.

The practical situation was worse than the legal one:

- **The app had been dark for five weeks.** The newest run in the database was
  29 June. Seventeen runs — including a Fartlek, a Tempo, three Long Runs and a
  Threshold Intervals session — had never arrived.
- **CalTrack had the same outage**, from the same cause, on the same day. It had
  counted zero exercise calories since 29 June — about 10,000 kcal missing from
  its net-intake maths.
- **90% of the heart-rate zone data was wrong**, and nobody knew. 608 of 676 runs
  claimed an average of 83% of time above Zone 4 at an average heart rate of 149,
  which is arithmetically impossible. 185 runs recorded time in Zone 6 while
  their maximum heart rate never reached the Zone 6 floor.

---

## What replaced Strava

**intervals.icu, sourced directly from Garmin.** Data now flows
Garmin → intervals.icu → RunCoach, never touching Strava.

Why this and not a Garmin scraper: intervals.icu has a documented API with real
credentials, runs over plain HTTPS so it works inside the existing Vercel setup,
supports OAuth for any future second athlete, and — uniquely — allows **writing
workouts back to the watch**.

### Sync

- Automatic twice daily via Vercel Cron, verified running unattended
- **Sync on app open** when data is more than 30 minutes stale, so what you see
  is current at the moment you look
- A "Sync Now" button, unchanged in behaviour from the Strava page it replaces
- Protected by a database-level unique constraint, so two syncs racing each other
  cannot produce a duplicate run

Strava is disarmed rather than deleted: its tokens are cleared, its cron removed,
its code left in place. Three independent reasons now prevent reconnecting it —
the API agreement, the old cron's filename matching, and CalTrack's deduplication
logic.

---

## New data the app never had

| | |
|---|---|
| **Daily wellness** | 369 days — HRV, sleep duration and score, resting heart rate, steps, VO2max |
| **Fitness / Fatigue / Form** | CTL, ATL and their difference, computed by intervals.icu from training load |
| **Grade-adjusted pace** | on 115 runs and 1,119 individual laps |
| **Cadence** | on 117 runs, converted to steps per minute |
| **Aerobic decoupling** | on 66 steady runs |
| **Lap detail** | 1,350 laps, up from 483 — with grade-adjusted pace and intensity per lap |

---

## The zone repair

The corrupt zone data was the largest single problem found.

- **116 runs recomputed** from their actual heart-rate streams against current
  bands. Impossible-Zone-6 count went from 204 to zero. Average time above Zone 4
  fell from 84% to 20%.
- **560 runs nulled.** No heart-rate stream exists for them anywhere, so they can
  never be repaired. A number known to be wrong is worse than no number — absent
  zones render as absent, wrong zones render as insight.

Max heart rate was also corrected from 185 to 191, with the six zone bands
rescaled proportionally.

---

## What the coach can now see

Each of these is a comparison the app already held both halves of and had never
made.

**Grade-adjusted pace.** Your quality sessions run on net-descending routes,
which flatters the raw pace by 36–48 seconds per kilometre. A session reading
6:17/km is 7:04/km grade-adjusted — easy-run effort wearing a threshold label.

**Aerobic decoupling.** Whether the aerobic system held through a run, computed
on grade-adjusted pace rather than raw speed, and rendered as a percentile
against your own history rather than against thresholds calibrated on other
athletes.

**Efficiency trend.** Grade-adjusted speed per heartbeat, as a 42-day rolling
median, compared against the same season a year earlier. This is the one number
that answers "is the training working" — training load alone only answers
"am I training."

**Intent versus actual.** What the plan asked for against what the zones say
happened, per run, stating what it cannot judge rather than passing silently.

**Recovery.** HRV against a 28-day baseline, sleep, resting heart rate — feeding
both the daily GO / EASY / REST verdict and the coach's context.

**Weekly scorecard.** Three rows: zone discipline and recovery carry a colour;
aerobic control deliberately does not, because grading it would import thresholds
that aren't calibrated for you.

---

## Push workouts to your watch

The plan can now be written to the intervals.icu calendar, which syncs to Garmin.

This was blocked for most of the project because the two systems disagreed about
heart-rate zones. Testing showed intervals.icu resolves percentage targets
against **max** heart rate — which both systems already agree is 191 — so the
app emits percentages computed from its own bpm targets and the disagreement
never enters the calculation.

Safeguards: a preview showing resolved bpm before anything is written, "push"
meaning "replace this week" so an adjusted plan can't leave stale sessions
behind, and a refusal if the two systems ever stop agreeing on max heart rate.

---

## The dashboard

The four tiles were replaced. `Total runs` and `Total distance` only ever
increase and had never changed a decision.

| Before | After |
|---|---|
| Total runs · 680 | **This week** · 19.6 / 39 km · 3 of 4 sessions |
| Total distance · 6,944 km | **Fitness** · 16.6 · with its 4-week change |
| This week · 19.6 km | **Recovery** · HRV against baseline · sleep |
| Active plan · Half Marathon | **Load ramp** · 7-day load vs 28-day average |

---

## CalTrack

`public.caltrack_runs` is now a view reading RunCoach's data live. No sync, no
API call, no code change in the dashboard. The bot's Strava integration was
removed entirely; `/run` manual logging still works through database triggers.

The two systems stored different calorie figures for the same runs — differing by
up to 137 kcal per run but only 81 kcal in total, which is exactly why a
totals-level check would have missed it. So the view cuts over at 29 June:
preserved rows before, RunCoach after.

---

## What it found about your training

These are the findings, not the features. All are conservative — the way the
data is classified biases each one *against* itself.

**Long runs are run harder than the plan asks.** Only 36% of long-run time is in
Zones 1–2; 32% is above Zone 4. Sixteen of twenty-one exceed the 20% threshold.
Easy runs, by contrast, are fine at 70% properly easy.

**Efficiency is flat while load climbs.** Grade-adjusted speed per heartbeat is
about 10% below the same period last year and has been level since May. Training
load is rising; efficiency is not responding.

**The training-days profile is stale.** It says Monday, Wednesday, Friday. You
actually run Monday 8, Wednesday 7, Sunday 5, Saturday 5 — and Friday, the
designated long-run day, twice in nine weeks. All five Sunday runs are off-plan.
That single field sets the ceiling on how much the weekly scorecard can judge.

Nothing here is a bug. The plan follows the profile faithfully. The profile
describes a week you don't train.

---

## Deliberately not built

- **ACWR** — superseded by Fitness/Fatigue/Form, and its published thresholds
  have been substantially challenged since 2019
- **Friel's decoupling bands as verdicts** — not calibrated for you; your own
  percentile is shown instead
- **Webhooks** — require an OAuth application registered by email; sync-on-open
  captures the value without it
- **Split shape** — decoupling already measures it, and better
- **A fifth dashboard tile for efficiency** — it moves 1–2% a month, so it would
  look identical for weeks

---

## Current state

```
runs 680 · zoned 116 · GAP 115 · cadence 117 · decoupling 66 · laps 1,350
wellness 369 days (HRV on 326) · orphaned feedback 0
CalTrack sees 46 runs through the view
last sync 2026-08-09 15:44 UTC — automatic
Fitness 16.6 · Form +4.1
```

---

## The principle underneath

Nearly every real bug found in this project was the same shape: **a number that
meant "we don't know" being rendered as though it meant something.**

A fatigue score of 5/10 that was a no-data default. Zone percentages that were
wrong rather than absent. A `[SENSITIVE]` placeholder that broke a build because
it was truthy. A wellness row that existed with nothing in it. An empty log
window read as proof a cron never fired.

The fix in every case was the same: let absent be absent, make estimates carry
their provenance, and make every comparison state its own sample size. The
metrics are the visible output. That discipline is what made them trustworthy.
