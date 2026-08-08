# Coaching analysis — what the coach sees, what it misses

Review of the existing coaching stack against two external skills (a per-run
Strava analysis skill and a `recovery-check` skill), to decide what is worth
adopting. Written 2026-08-06, after the intervals.icu migration made per-second
streams and daily wellness available for the first time.

---

## Part 1 — How the coach currently operates

### The three-layer hierarchy

`lib/ai/coach-prompts.ts` instructs the model to follow a strict priority order:

1. **Athlete data** (ground truth — what actually happened)
2. **Previous coach patterns** (proven for *this* athlete, retrieved from `coach_workouts` / `coach_phases`)
3. **Book methodology** (Triphasic, 80/20, Norwegian Method — general rules)

with explicit conflict resolution: *"If athlete data shows fatigue but methodology
says push: ASK how they feel today."* Layer 2 is the genuine differentiator — no
off-the-shelf skill has the athlete's own former coach's sessions.

### Methodology encoded in `COACH_STATIC_BLOCK`

- **Triphasic** — Base → Support → Specific, with the support-phase paradox
  (train *around* race pace, 106–114% and 86–94%, never *at* it)
- **80/20 polarised** — grey-zone avoidance stated as non-negotiable
- **Norwegian** — lactate-guided double threshold, 2.3–3.0 mmol/L targets
- **Goal anchoring** — day-to-day advice anchors on the plan's active focus, not
  the long-term aspiration, because conflating them is how athletes get injured

### What reaches the model per request (`lib/rag/user-formatter.ts`)

`## Athlete Profile` · `## Current Training Status` · `## Recent Runs (Last 14 Days)`
· `## Active Training Plan` · `## Recovery (last 7 days)` · `## This Week Summary`

Per run: distance, duration, pace, avg/max HR, `pct_z1..pct_z6`, TRIMP, run type,
and — for quality sessions — per-lap blocks with HR delta versus the first lap.
Post-run feedback is joined by `run_id` and rendered inline.

### Deterministic layers (no LLM)

- `classifyRun` — types the session from **zone distribution, not the title**
- `calculateTrimp` — Banister TRIMP per run
- `computeReadiness` v2 — GO/EASY/REST from fatigue, yesterday's Z4+, planned
  workout, HRV vs baseline, sleep, resting HR
- `lib/supervisor/` — preflight coverage checks, telemetry, Haiku critic scoring
  each response on 5 axes

---

## Part 2 — The gap, measured

Searching the whole codebase for the concepts the external skills rely on:

| Concept | Present? |
|---|---|
| Aerobic decoupling (Pa:HR) | **absent** |
| Cardiac drift | partial — per-lap HR delta only |
| Grade-adjusted pace | **absent** (field arrives, is discarded) |
| Cadence | **absent** (field arrives, is discarded) |
| Split shape / negative-split | absent |
| Effort cost vs recent baseline | absent |
| Grey-zone intent-vs-actual | absent as a *judgment* (zones exist, comparison isn't made) |
| ACWR | absent — but see Part 4, `ctl`/`atl` supersedes it |

### The important structural fact

`upsert-run.ts` fetches the HR stream **transiently**, uses it to bucket zones,
and discards it. The client requests only:

```
/activity/{id}/streams?types=heartrate,time
```

The activity also exposes `distance`, `velocity_smooth`, `altitude`, `cadence`,
`stance_time`, `vertical_oscillation`, `step_length`. **Decoupling needs exactly
one more stream type in the same call.** Nothing about the architecture blocks it.

---

## Part 3 — Adopt

### Tier 1 — data already arrives, currently discarded

**1. Grade-adjusted pace (`gap`).** One field, already on every activity payload
and on every `icu_interval`. Zero compute. Add `gap_speed` to `runs` and `laps`,
render alongside raw pace.

Why it matters — measured on real sessions:

| Date | Session | Raw pace | GAP | Δ | avg HR |
|---|---|---|---|---|---|
| 2026-08-03 | Threshold Intervals | 6:17/km | **7:04/km** | **+48s** | 142 |
| 2026-08-02 | Running | 7:43/km | 7:41/km | −2s | 135 |
| 2026-08-01 | Long Run | 7:26/km | 7:22/km | −3s | 152 |
| 2026-07-25 | Long Run | 7:50/km | 7:48/km | −2s | 145 |
| 2026-07-20 | Tempo | 6:46/km | **7:22/km** | **+36s** | 141 |

Both *quality* sessions were run on net-descending terrain; the easy and long
runs were flat. The raw paces overstate the work by 36–48 s/km on precisely the
days where pace is being used to judge intensity. Without GAP the coach reads a
6:17/km "threshold" session; with it, the true equivalent is 7:04/km — which is
easy-run pace, and explains why HR never exceeded 166.

**2. Cadence.** `average_cadence` is populated on 116/117 runs and per interval.
A form/efficiency signal that costs one column.

### Tier 2 — computable from streams, needs logic

**3. Aerobic decoupling (Pa:HR).** The single highest-value addition. Split
moving time in half; efficiency factor = mean speed ÷ mean HR for each half;
decoupling = (EF₁ − EF₂) / EF₁ × 100.

Thresholds (Friel / TrainingPeaks convention): **<5%** aerobic durability holding
· **5–8%** moderate fade · **>8%** went too hard, or heat/fuel/fitness let the
back half slip.

Requires adding `distance` (or `velocity_smooth`) to the existing stream request,
computing at ingest, storing `decoupling_pct` on `runs`. Should only be computed
for steady efforts — it is meaningless on an interval session, where the
work/recovery structure dominates. Gate on `run_type` and skip when the session
is `Intervals`/`Fartlek`.

For a base-building athlete at CTL 17.7, decoupling is the metric that answers
"is the aerobic engine actually rebuilding" — which nothing currently answers.

**4. Effort cost vs recent baseline.** "This pace used to sit at 145 bpm and now
costs 155." Computable from history already in the database, and it is the
automated form of the anomaly hunt done by hand on 2026-08-03. Best expressed as
HR-at-GAP-pace versus a trailing 28-day median for comparable run types.

**5. Grey-zone / intent-vs-actual discipline.** The plan says what the session was
*meant* to be; `pct_z1..z6` says what it *was*. Joining them is a comparison the
app never makes, despite holding both sides. Given that 80/20 is stated as
"non-negotiable" in the system prompt, the coach should be able to say "you
planned easy and spent 34% in Z3."

**6. Split shape.** Laps are stored for 115 runs. Negative vs positive split,
fastest/slowest km, where it faded — all derivable, none surfaced.

### Tier 3 — presentation

**7. "Show the numbers you used."** The external skill's best line: *"A read I can
audit is one I can trust."* This aligns exactly with the supervisor's purpose.
Worth adding to `COACH_STATIC_BLOCK` as a rule: when making a quantitative claim,
cite the figure it rests on.

**8. Scorecard.** A scannable green/yellow/red summary per run — pacing,
aerobic control (decoupling), zone discipline, red-flag check. The dashboard
already has this shape for the readiness badge; extending it to per-run analysis
is consistent. Adopt the format, not the emoji-heavy styling.

---

## Part 4 — Do not adopt

**ACWR (acute:chronic workload ratio).** Two reasons.

First, it is superseded by data already held: intervals.icu supplies `ctl` and
`atl` (exponentially weighted 42/7-day impulse-response), which model the same
fitness-versus-fatigue idea with better-behaved weighting than a 7:28 rolling
ratio. Form (`ctl − atl`) is already in `daily_wellness` and already rendered to
the coach.

Second, the "0.8–1.3 sweet spot / >1.5 danger" framing the skill presents as
settled is not. The original ACWR findings have been substantially challenged on
methodological grounds since 2019 — mathematical coupling between the acute and
chronic terms, and sensitivity to how the ratio is binned. Encoding those exact
bounds into the coach would be presenting a contested number as a fact.

**The "recovery interview".** The skill opens by asking sleep baseline, whether
HRV is tracked, life stress, injury history. `athlete_profile` holds the injury
history and HR anchors, and `daily_wellness` holds 366 days of measured sleep and
HRV. Asking would be worse than reading.

**File-based persistence** (`health/YYYY-MM-DD-recovery.md`). The app has
`coach_reports` with a `report_type` discriminator.

**Strava as the data source.** Obsolete here.

**The competitive framing.** Both skills define themselves against a named
competitor. That is marketing, not method, and it would leak into the coach's
voice.

---

## Part 5 — A correction this review produced

An earlier analysis in chat flagged the 3 August session as evidence of
fatigue-suppressed heart rate: *a minute per km faster than the long run at 10 bpm
lower HR.* GAP substantially undercuts that reading.

Grade-adjusted, the comparison is 7:04/km at 142 bpm versus 7:22/km at 152 bpm —
18 s/km rather than 69 s/km. Terrain explains most of the gap that was attributed
to physiology. Accumulated fatigue may still be a contributing factor (HRV was
1.65 SD low that morning, resting HR +4.2, sleep 5.9 h, Form −6.2, and HRV then
fell to −5.04 SD the next day) but it is no longer the simplest explanation, and
it should not have been asserted as one.

That is the argument for Tier 1 in a sentence: the field that would have prevented
the error was already in the payload, and was being thrown away.

---

## Part 6 — What actually shipped, and where it diverged (added 2026-08-07)

Everything above is the review **as written on 2026-08-06**, kept verbatim because
the reasoning is the point. Three of its recommendations were changed by what the
data showed when they were built. Read this section before treating anything above
as a specification.

**Tier 2 #3 — Friel's `<5 / 5-8 / >8` bands were NOT adopted as verdicts.**
Two reasons found during implementation. The shipped decoupling is
**grade-adjusted** (computed from per-lap `gap_pace_min_km`, recorded as
`decoupling_method = 'lap_gap'`), so it is not the same quantity Friel's bands are
defined on — those assume raw Pa:HR. And measured on this athlete's own 66 runs:
median 6.5%, with 25 runs above 8%. Applying the bands unchanged would label a
third of his easy and long running "went too hard". It renders as a **percentile
against his own history** instead. Gates that are not in the section above but are
load-bearing: laps outside 3-12 min/km discarded, refusal when >10% of session
duration is discarded, halves within 40-60% of total time.

**Tier 2 #4 — shipped as Efficiency Factor, not "HR at GAP pace".** The formulation
above (HR-at-GAP-pace vs a trailing 28-day median) was replaced by grade-adjusted
speed per heartbeat, as a **42-day rolling median**, compared against a
**season-matched** baseline 84 days wide centred one year earlier. The 28-day
trailing comparison is confounded by heat — Israeli summer raises HR for the same
work, so a trailing window measures the weather as much as the athlete. The
baseline refuses below 8 samples: the naive same-42-days-last-year window contains
exactly ONE run, and produced a confident-looking -13.5%.

**Tier 3 #8 — the scorecard is weekly, not per-run, and is deliberately not
uniformly coloured.** Per-run was wrong for the metrics involved. And only two of
its axes may carry a colour: zone discipline (measured against the plan's own
stated target) and recovery (`computeReadiness` already emits GO/EASY/REST).
Aerobic control renders as a percentile with **no colour**, because colouring it
would reimport Friel's bands through the presentation layer immediately after they
were deliberately kept out of the data layer. A scorecard where every row is
red/amber/green teaches the reader that every row is equally a judgment, including
the row that is not.

**Tier 2 #6 (split shape) was not built.** It overlaps decoupling substantially —
first-half versus second-half efficiency is what decoupling already measures, and
better, because decoupling is grade-adjusted.

**Part 4 stands unchanged.** ACWR was not adopted.
