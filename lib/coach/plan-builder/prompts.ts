/**
 * Prompts for the three model steps of the staged plan builder.
 *
 *   outline  — the head coach decides the strategy. Short output, deep reasoning.
 *   writer   — one phase (≤4 weeks) written against the outline, in parallel.
 *   review   — the head coach reads the assembled plan and asks whether the
 *              pieces fit.
 *
 * Every prompt sends COACH_STATIC_BLOCK as the cacheable prefix (persona and
 * coaching rules); what is below is the dynamic part.
 */

import {
  PLAN_DAY_ANCHOR_RULES,
  PLAN_STRENGTH_RULES,
  PLAN_TARGET_HR_RULES,
} from '@/lib/ai/coach-prompts';
import type { PlanWeek } from '@/lib/db/types';
import { formatResearch } from './prepare';
import { weekOneLabel } from './dates';
import type { BuildRequest, CoherenceIssue, OutlineWeek, PlanOutline, PreparedStage, Violation } from './types';

function params(req: BuildRequest, prep: PreparedStage): string {
  return [
    '## PLAN PARAMETERS',
    `- Type: ${req.planType}`,
    `- Duration: ${req.durationWeeks} weeks. Week 1 is ${weekOneLabel(prep.startDate)}; weeks run Sunday to Saturday.`,
    prep.weekOneSoFar
      ? `- Week 1 is already under way: ${prep.weekOneSoFar.runs} run(s), ${prep.weekOneSoFar.km} km logged since Sunday. Treat those as done and prescribe only the rest of the week.`
      : '',
    `- Runs per week: ${req.runsPerWeek}`,
    `- Target race: ${req.targetRace || 'none'}`,
    `- Training days: ${prep.trainingDaysText ?? 'NOT SPECIFIED — say so in the rationale instead of assuming a schedule'}`,
    `- Notes from the athlete: ${req.notes || 'none'}`,
  ].filter(Boolean).join('\n');
}

function defaultPhaseSplit(req: BuildRequest, prep: PreparedStage): string {
  const racing = !!(req.targetRace || req.raceDate) && !prep.race.durationNote?.includes('ends before');
  const training = racing ? req.durationWeeks - 1 : req.durationWeeks;
  const base = Math.max(1, Math.round(training * 0.25));
  const support = Math.max(2, Math.round(training * 0.5));
  const specific = Math.max(1, training - base - support);
  return `Default split, to depart from when the methodology says so: Base ${base} wk → Support/Build ${support} wk → Specific/Peak ${specific} wk${racing ? ' → Taper 1 wk' : ''}.`;
}

// ---------------------------------------------------------------------------
// Step 4 — outline
// ---------------------------------------------------------------------------

export function buildOutlinePrompt(req: BuildRequest, prep: PreparedStage): { system: string; user: string } {
  const r = prep.research;
  const system = `${r.coachContext}

${r.intakeBlock}

${prep.athlete.text}

${prep.race.text}

${r.macroText ? `${r.macroText}\n\n**This block serves the phase marked CURRENT above.** Its weekly km and vert ranges are the band you work inside.\n` : ''}
${r.exemplarsText}

${formatResearch(r)}

${params(req, prep)}

## YOUR TASK: THE PLAN OUTLINE (STRATEGY ONLY — NO DAILY WORKOUTS)

You are the head coach. Decide the strategy for this plan; other coaches will
write the daily sessions from your outline, one phase each, in parallel, so the
outline is the CONTRACT they follow. They will not see each other's work — any
continuity must be written into your weekly targets.

Decide, and justify from the research and the athlete brief:
1. **Phases** — names, week ranges, purpose, key session types, strength focus,
   and 2-3 measurable exit criteria each. ${defaultPhaseSplit(req, prep)}
2. **Every week's targets** — total km${prep.race.hasElevation ? ', total climbing (m)' : ''}, long-run km,
   number of quality sessions, whether it is a recovery week, and which strength
   sessions it carries. Week 1 starts from the MEASURED numbers in the athlete
   brief. Progress volume ~10%/week at most${prep.race.hasElevation ? ' and climbing ~15%/week at most (climbing is the newer stress — cut it first in a down week)' : ''}.
   Recovery weeks are clearly lighter than the week before (≥15% less volume${prep.race.hasElevation ? ' and less climbing' : ''}, less strength).
   ${prep.race.durationNote ? `⚠️ ${prep.race.durationNote}` : (req.targetRace || req.raceDate ? 'The final week is race week: taper to ≤70% of peak volume.' : '')}
3. **Day roles** — which of HIS training days carries quality, the long run,
   easy running and strength. Only days from the Training days line.
4. **The strength programme** — name each distinct strength session once
   (id → name, focus, minutes). Weeks reference sessions by id. Do NOT list
   exercises: a strength coach writes them from your names and focus, so make
   the focus specific (what it trains, why now, how it progresses from the
   previous session). Follow these rules for frequency, placement and progression:

${PLAN_STRENGTH_RULES}

5. **Decisions** — state season-level decisions explicitly (poles, fuelling
   practice, altitude, anything the race brief raises). Unstated is not decided.
6. **Rationale** — the athlete's starting point, the gap to the race, the
   strategy that closes it, and which sources it rests on.${prep.athlete.dayMismatch ? ' Mention the training-day pattern warning.' : ''}

**Be brief — reason fully, write tersely.** The outline is a contract, not an
essay; every extra sentence delays the plan. Rationale ≤ 120 words. Phase
purpose ≤ 25 words, ≤ 4 key sessions and ≤ 3 exit criteria of a few words each.
Week focus ≤ 8 words. ≤ 5 decisions, one sentence each.

Return ONLY this JSON object:
{
  "plan_name": "…",
  "methodology": "primary methodology and sources",
  "goal": "…",
  "rationale": "…",
  "sources": ["Book title", "Expert plan: …"],
  "day_roles": { "Monday": "quality", "Friday": "long run", "Wednesday": "easy + strength" },
  "phases": [
    { "name": "Base", "start_week": 1, "end_week": 4, "purpose": "…", "key_sessions": ["…"],
      "strength_focus": "…", "exit_criteria": ["…"] }
  ],
  "weeks": [
    { "week": 1, "phase": "Base", "focus": "…", "total_km": 30,${prep.race.hasElevation ? ' "total_elevation_gain_m": 250,' : ''}
      "long_run_km": 11, "is_recovery": false, "quality_sessions": 1, "strength": ["foundation", "foundation"] }
  ],
  "strength_sessions": {
    "foundation": { "name": "Foundation strength", "duration_minutes": 30,
      "focus": "bodyweight single-leg patterns, hip and trunk stability; calf/foot base for PF history" }
  },
  "decisions": ["Poles: …"]
}
Every week 1-${req.durationWeeks} must appear in "weeks". Every strength id used must exist in "strength_sessions".`;

  return { system, user: `Write the outline for my ${req.durationWeeks}-week ${req.planType} plan. Return only the JSON.` };
}

// ---------------------------------------------------------------------------
// Step 5 — phase writer
// ---------------------------------------------------------------------------

export interface WriteChunk {
  phase: string;
  weeks: number[];
}

function targetLine(w: OutlineWeek, hasElevation: boolean): string {
  return `- Week ${w.week} (${w.phase}${w.is_recovery ? ', RECOVERY' : ''}): ${w.total_km} km` +
    (hasElevation && w.total_elevation_gain_m != null ? `, ${w.total_elevation_gain_m} m climbing` : '') +
    `, long run ${w.long_run_km} km, ${w.quality_sessions} quality, strength [${w.strength.join(', ') || 'none'}] — ${w.focus}`;
}

/**
 * The athlete and previous-coach layers of the 3-layer context, without the
 * general book layer.
 *
 * Measured 2026-09-27: the general book excerpts were 87% of the 3-layer
 * context (~102k of 117k characters) and every writer call re-read them —
 * 18 calls, ~$3.40 of a ~$6 build. The books have already shaped the outline
 * the writers follow, and the targeted research (one excerpt block per need)
 * still reaches every writer, so the general block was paid for twice. The
 * athlete data — profile, HR zones, recovery, efficiency, last 14 days of runs
 * — and the previous coach's workouts are kept whole.
 */
export function athleteAndCoachLayers(coachContext: string): string {
  const cut = coachContext.indexOf('### Priority 3');
  return cut > 0 ? coachContext.slice(0, cut).trimEnd() : coachContext;
}

/**
 * Split into a SHARED part — byte-identical for every writer call in a build,
 * sent as the cached prefix — and the chunk's own task. Repair and fix calls
 * then read the shared part from the prompt cache at ~10% of the price.
 * Nothing chunk-specific may enter `shared`, or the cache stops hitting.
 */
export function buildWriterPrompt(
  req: BuildRequest,
  prep: PreparedStage,
  outline: PlanOutline,
  chunk: WriteChunk,
  fix?: { problems: string[]; current: PlanWeek[] },
): { shared: string; system: string; user: string } {
  const hasElev = prep.race.hasElevation;
  const mine = outline.weeks.filter((w) => chunk.weeks.includes(w.week));
  const before = outline.weeks.find((w) => w.week === chunk.weeks[0] - 1);
  const after = outline.weeks.find((w) => w.week === chunk.weeks[chunk.weeks.length - 1] + 1);
  const phase = outline.phases.find((p) => p.name === chunk.phase);
  const libraryIds = Object.keys(outline.strength_sessions);

  const shared = `${athleteAndCoachLayers(prep.research.coachContext)}

${prep.race.text}

${formatResearch(prep.research)}

${params(req, prep)}

## THE HEAD COACH'S OUTLINE — THE CONTRACT EVERY PHASE WRITER FOLLOWS
Plan: ${outline.plan_name}
Rationale: ${outline.rationale}
Day roles: ${Object.entries(outline.day_roles).map(([d, r]) => `${d} = ${r}`).join('; ')}
Decisions: ${outline.decisions.join(' | ') || 'none'}
Phases:
${outline.phases.map((p) => `- ${p.name} (weeks ${p.start_week}-${p.end_week}): ${p.purpose}. Key sessions: ${p.key_sessions.join('; ')}. Strength: ${p.strength_focus}. Exit: ${p.exit_criteria.join('; ')}`).join('\n')}
Weekly targets:
${outline.weeks.map((w) => targetLine(w, hasElev)).join('\n')}
Strength library (reference by id — do NOT define new sessions): ${libraryIds.join(', ') || 'none'}

## HOW TO WRITE WEEKS
You are one of several coaches writing this plan in parallel, each a few
weeks of it, from the outline above. You will be told which weeks are yours.

Rules:
- A workout's "distance" values must add up to the week's "total_km" (±10%) — add them up before you write the total.
- Hit each week's targets: totals within ±10%, long run within ±15%.
- Put the long run on the long-run day from the day roles. Keep quality sessions on the quality day. Never two hard days back to back.
- Attach each week's strength sessions to training days with "strength": "<id>" — exactly the ids listed for that week. Loaded strength goes straight after the quality session on the same day. Never on the long-run day, the day before it, or the day before a quality session.
${hasElev ? `- Every week has "total_elevation_gain_m" and every run has "elevation_gain_m"; they must add up to the week total (±15%).
- **Incline metres are arithmetic, not an estimate:** metres = speed (km/h) × 1000 × grade% / 100 × minutes / 60. 20 min at 10% and 5.5 km/h = 183 m; 5x5 min at 12% and 5 km/h = 250 m. Write minutes, grade and speed in the description, put the computed metres in "elevation_gain_m" (plus any outdoor climb), and SIZE the session so the week stays on its climbing target — cut minutes, not grade. A checker recomputes every description.
- A trail loop or out-and-back climbs what it descends.
- Prescribe climbing sessions as time on feet plus a vert target, and give power-hiking its own cues.` : '- Do NOT emit elevation fields — this plan has no climbing target.'}
- Emit "indoor_alternative" on every run (description under 60 characters).
- Descriptions under 80 characters. Cite "source" per workout (book, expert plan, or previous coach).

${PLAN_TARGET_HR_RULES}

${PLAN_DAY_ANCHOR_RULES}

Return ONLY this JSON object — your weeks and nothing else:
{
  "weeks": [
    {
      "week_number": 5,
      "phase": "<phase name from the outline>",
      "focus": "…",
      "total_km": 30,${hasElev ? '\n      "total_elevation_gain_m": 250,' : ''}
      "workouts": {
        "Monday": {
          "type": "Tempo", "duration": "50 min", "distance": "9 km",${hasElev ? ' "elevation_gain_m": 60,' : ''}
          "target_hr": "Z3-Z4 (143-168)", "target_pace": "5:30-5:45/km",
          "description": "WU 15min | 3x8min Z4, 2min jog | CD 10min",
          "indoor_alternative": { "type": "Treadmill", "equipment": "treadmill", "description": "1% grade, same structure" },
          "source": "…"
        },
        "Wednesday": { "type": "Easy Run + Strength", "distance": "7 km", "strength": "${libraryIds[0] ?? 'foundation'}", "…": "…" }
      }
    }
  ]
}`;

  const system = `## YOUR WEEKS: ${chunk.weeks.join(', ')} (${chunk.phase})
${phase ? `Phase purpose: ${phase.purpose}\nExit criteria this phase works toward: ${phase.exit_criteria.join('; ')}` : ''}

Your targets:
${mine.map((w) => targetLine(w, hasElev)).join('\n')}

Continuity — other coaches write the neighbouring weeks from the same outline:
${before ? targetLine(before, hasElev).replace('- ', '- BEFORE yours: ') : "- Yours is the first block: start from the athlete's measured current load."}
${after ? targetLine(after, hasElev).replace('- ', '- AFTER yours: ') : '- Yours is the last block.'}`;

  const user = fix
    ? `Your previous version of these weeks broke these rules:\n${fix.problems.map((p) => `- ${p}`).join('\n')}\n\n` +
      `Previous version:\n${JSON.stringify({ weeks: fix.current })}\n\n` +
      `Rewrite weeks ${chunk.weeks.join(', ')} fixing EVERY problem listed, changing as little else as possible. Return only the JSON.`
    : `Write weeks ${chunk.weeks.join(', ')}. Return only the JSON.`;
  return { shared, system, user };
}

// ---------------------------------------------------------------------------
// Step 7 — does it all fit (the head coach's half)
// ---------------------------------------------------------------------------

/** One line per session, so a 12-week plan fits in a few thousand tokens. */
export function renderPlanCompact(weeks: PlanWeek[]): string {
  return [...weeks].sort((a, b) => a.week_number - b.week_number).map((w) => {
    const days = Object.entries(w.workouts ?? {}).map(([d, x]) => {
      const s = (x as { strength?: unknown }).strength;
      return `  ${d.slice(0, 3)}: ${x.type}` +
        (x.distance ? ` ${x.distance}` : '') +
        (x.elevation_gain_m != null ? ` +${x.elevation_gain_m}m` : '') +
        (x.target_hr ? ` ${x.target_hr}` : '') +
        (x.description ? ` — ${x.description}` : '') +
        (s ? ` [strength: ${typeof s === 'string' ? s : (s as { name?: string }).name}]` : '') +
        // Shown so the reviewer does not report a missing indoor alternative
        // that is present — it did exactly that before this was rendered.
        (x.indoor_alternative ? ` [indoor: ${x.indoor_alternative.type}]` : '');
    });
    return `W${w.week_number} ${w.phase} · ${w.total_km} km` +
      (w.total_elevation_gain_m != null ? ` · ${w.total_elevation_gain_m} m` : '') +
      ` · ${w.focus}\n${days.join('\n')}`;
  }).join('\n');
}

export function buildReviewPrompt(
  req: BuildRequest,
  prep: PreparedStage,
  outline: PlanOutline,
  weeks: PlanWeek[],
  measured: CoherenceIssue[],
  remainingRuleErrors: Violation[],
): { system: string; user: string } {
  const system = `${prep.athlete.text}

${prep.race.text}

${params(req, prep)}

## THE OUTLINE (what the plan was supposed to be)
Rationale: ${outline.rationale}
Day roles: ${Object.entries(outline.day_roles).map(([d, r]) => `${d} = ${r}`).join('; ')}
Decisions: ${outline.decisions.join(' | ') || 'none'}
${outline.phases.map((p) => `- ${p.name} (weeks ${p.start_week}-${p.end_week}): ${p.purpose}. Exit: ${p.exit_criteria.join('; ')}`).join('\n')}
Strength library: ${Object.entries(outline.strength_sessions).map(([id, s]) => `${id} = ${s.name}${s.focus ? ` (${s.focus})` : ''}`).join('; ')}

## THE ASSEMBLED PLAN (written phase by phase, in parallel, by different coaches)
${renderPlanCompact(weeks)}

## ALREADY FOUND BY MEASUREMENT — do not repeat these
${[...measured.map((i) => `- ${i.problem}`), ...remainingRuleErrors.map((v) => `- W${v.week}: ${v.message}`)].join('\n') || '- nothing'}

## YOUR TASK: DOES IT ALL FIT?
You are the head coach. Every week was checked against rules one at a time; your
job is the whole. Read the plan as one plan and answer four questions:
1. **Phase to phase** — does each phase pick up where the last one ended (volume,
   climbing, long run, intensity), or does it reset or leap at the join?
2. **Running, climbing and strength together** — do recovery weeks back off all
   three at once? Does heavy eccentric strength collide with the biggest descent
   or climbing sessions? Does strength drop to maintenance as specific work peaks?
3. **Weeks against the outline** — does each week actually serve its phase's
   purpose (a "power-hiking" phase must contain gradient work, not just km)? Do the
   exit criteria become reachable?
4. **Plan against the athlete and the race** — is the start right for his measured
   load, does the peak prepare him for THIS race's demand, is the injury history
   respected, does the final week land correctly?

Severity: "must_fix" ONLY for problems that would materially hurt the athlete or
leave him unprepared for the race — name the weeks and say exactly what to change.
Everything else is a "note". At most 6 issues. If it fits, say so; do not invent
problems to have something to say.

Return ONLY this JSON:
{ "verdict": "coherent" | "needs_changes", "summary": "2-3 sentences",
  "issues": [ { "severity": "must_fix" | "note", "weeks": [5, 6], "problem": "…", "fix": "…" } ] }`;

  return { system, user: 'Review the assembled plan. Return only the JSON.' };
}

// ---------------------------------------------------------------------------
// Step 5, alongside the phase writers — the strength programme's exercises
// ---------------------------------------------------------------------------

/**
 * The outline names each strength session; this writes its exercises. Split
 * out of the outline on 2026-09-27: full exercise lists were 8,000 of the
 * outline's 30,000 characters, on the head coach's slowest step. Written here
 * in parallel with the phase writers, it costs no wall-clock time.
 */
export function buildStrengthPrompt(req: BuildRequest, prep: PreparedStage, outline: PlanOutline): { system: string; user: string } {
  const usage = Object.keys(outline.strength_sessions).map((id) => {
    const weeks = outline.weeks.filter((w) => w.strength.includes(id)).map((w) => w.week);
    return `- "${id}": ${outline.strength_sessions[id].name} — ${outline.strength_sessions[id].focus ?? ''} ` +
      `(${outline.strength_sessions[id].duration_minutes ?? 30} min; weeks ${weeks.join(', ') || 'none'})`;
  });
  const system = `${prep.athlete.text}

${prep.race.text}

${formatResearch(prep.research)}

## THE HEAD COACH'S STRENGTH PROGRAMME
Phases: ${outline.phases.map((p) => `${p.name} (wk ${p.start_week}-${p.end_week}): ${p.strength_focus}`).join(' | ')}
Sessions to write, in the order they are used:
${usage.join('\n')}

${PLAN_STRENGTH_RULES}

## YOUR TASK
Write the exercises for every session above — 5-8 exercises, fitting its minutes.
Keep each session's id, name and focus. Each session must progress from the one
before it in the programme. Return ONLY:
{ "strength_sessions": { "<id>": { "name": "…", "duration_minutes": 30, "focus": "…",
  "exercises": [ { "exercise": "…", "sets": 3, "reps": "8-10", "each_side": true, "rest_seconds": 60, "load": "bodyweight", "note": "optional" } ] } } }`;
  return { system, user: `Write the exercises for the ${usage.length} strength sessions of my ${req.planType} plan. Return only the JSON.` };
}
