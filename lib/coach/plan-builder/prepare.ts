/**
 * Steps 1-3 of the staged plan builder — no model calls, only measurement and
 * retrieval:
 *
 *   1. assess the athlete  — where he actually is (not where the form says)
 *   2. understand the race — what it demands, and the gap between the two
 *   3. research            — what the methodology says about each need that
 *                            gap creates, searched need by need
 *
 * The old generator ran one book search for the whole plan ("Create a 12-week
 * Trail plan..."), so power hiking, eccentric strength and taper all competed
 * for the same handful of chunks. Searching per need is what lets the outline
 * cite the Uphill Athlete on climbing AND Pfitzinger on the taper.
 */

import { supabase } from '@/lib/db/supabase';
import { getAthleteProfile } from '@/lib/db/profile';
import { buildTrainingState, formatTrainingState, parseTrainingDays } from '@/lib/coach/training-state';
import { buildContext } from '@/lib/rag/context-builder';
import { retrieveBookContext } from '@/lib/rag/book-retriever';
import { buildPlanGenerationContext } from '@/lib/rag/plan-generation-context';
import { buildCoachDynamicBlock, buildRaceDemandBlock } from '@/lib/ai/coach-prompts';
import { exemplarsForRequest } from '@/lib/coach/plan-exemplars-db';
import { getActiveMacroPlan, phaseForWeek, formatMacroPlan } from '@/lib/coach/macro-plan';
import { daysBetweenDateStr, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { AthleteProfile } from '@/lib/db/types';
import type { AthleteBrief, BuildRequest, PreparedStage, RaceBrief, Research } from './types';
import { planStartSunday } from './dates';

export { planStartSunday, weekOneLabel } from './dates';

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------------------------------------------------------------------------
// Step 1 — the athlete
// ---------------------------------------------------------------------------

type TrainingState = Awaited<ReturnType<typeof buildTrainingState>>;

async function assessAthlete(
  userId: string, req: BuildRequest, state: TrainingState, profile: AthleteProfile | null,
): Promise<AthleteBrief> {
  const { data: longRows } = await supabase.from('runs').select('distance_km').eq('user_id', userId)
    .gte('date', userDateStrDaysAgo(42)).order('distance_km', { ascending: false }).limit(1);

  const complete = state.weeks.filter((w) => !w.isPartial);
  const last4 = complete.slice(-4);
  const recentWeeklyKm = last4.length >= 2 ? round1(mean(last4.map((w) => w.km))!) : null;
  const vertWeeks = last4.map((w) => w.vertM).filter((v): v is number => v !== null);
  const recentWeeklyVertM = vertWeeks.length >= 2 ? Math.round(mean(vertWeeks)!) : null;
  const peakWeeklyKm12w = complete.length ? round1(Math.max(...complete.map((w) => w.km))) : null;
  const longestRunKm6w = longRows?.[0]?.distance_km != null ? round1(Number(longRows[0].distance_km)) : null;

  const allowedDays = req.trainingDays && req.trainingDays.length > 0
    ? [...req.trainingDays]
    : parseTrainingDays(profile?.training_days);

  const actualRunDays = Object.entries(state.adherence.actualDayCounts)
    .map(([day, runs]) => ({ day, runs }))
    .filter((d) => d.runs > 0)
    .sort((a, b) => b.runs - a.runs);
  const totalRuns = actualRunDays.reduce((a, d) => a + d.runs, 0);

  // A plan built on days he does not run on is a plan he will not follow —
  // the stale-profile problem measured on 2026-08-08. Flag it; never override
  // the days he asked for.
  let dayMismatch: string | null = null;
  if (allowedDays && totalRuns >= 8) {
    const expectedPerDay = totalRuns / allowedDays.length;
    const rare = allowedDays.filter((d) => (state.adherence.actualDayCounts[d] ?? 0) < expectedPerDay * 0.35);
    const offPlan = actualRunDays.filter((d) => !allowedDays.includes(d.day) && d.runs >= totalRuns * 0.15);
    const parts: string[] = [];
    if (rare.length) parts.push(`rarely runs on ${rare.map((d) => `${d} (${state.adherence.actualDayCounts[d] ?? 0} of ${totalRuns} runs)`).join(', ')}`);
    if (offPlan.length) parts.push(`often runs on ${offPlan.map((d) => `${d.day} (${d.runs})`).join(', ')}, which is not a chosen day`);
    if (parts.length) dayMismatch = `Over the last ${state.windowDays} days he ${parts.join(' and ')}.`;
  }

  const header = [
    '## ATHLETE BRIEF — MEASURED, NOT ASSUMED',
    `- Last 4 complete weeks: ${recentWeeklyKm ?? 'unknown'} km/week` +
      `, ${recentWeeklyVertM ?? 'unmeasured'}${recentWeeklyVertM !== null ? ' m' : ''} climbing/week.`,
    `- Biggest week in 12: ${peakWeeklyKm12w ?? 'unknown'} km. Longest run in 6 weeks: ${longestRunKm6w ?? 'unknown'} km.`,
    `- Chosen training days: ${allowedDays?.join(', ') ?? 'NOT STATED'}.`,
    `- Days he actually ran on: ${actualRunDays.map((d) => `${d.day} ${d.runs}`).join(', ') || 'no runs in window'}.`,
    dayMismatch ? `- ⚠️ ${dayMismatch} Build on the chosen days as instructed, and say in the rationale that the pattern differs.` : '',
    '',
    'Week 1 must start from the measured numbers above, not from the plan type.',
  ].filter(Boolean).join('\n');

  return {
    recentWeeklyKm, recentWeeklyVertM, peakWeeklyKm12w, longestRunKm6w,
    allowedDays, actualRunDays, dayMismatch,
    text: `${header}\n\n${formatTrainingState(state)}`,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — the race
// ---------------------------------------------------------------------------

function understandRace(req: BuildRequest, climb: TrainingState['climb'] | undefined, startDate: string): RaceBrief {
  const distanceKm = req.raceDistanceKm ?? null;
  const elevationGainM = req.raceElevationGainM ?? null;
  const vertPerKm = distanceKm && elevationGainM ? round1(elevationGainM / distanceKm) : null;
  const hasElevation = !!elevationGainM && elevationGainM > 0;

  let weeksToRace: number | null = null;
  let durationNote: string | null = null;
  if (req.raceDate) {
    const days = daysBetweenDateStr(startDate, req.raceDate);
    weeksToRace = Math.max(1, Math.ceil((days + 1) / 7));
    if (weeksToRace > req.durationWeeks) {
      durationNote = `Race day is ${weeksToRace} weeks away; this ${req.durationWeeks}-week plan ends before it. ` +
        'Do NOT taper in the final week — this block hands over to the next one.';
    } else if (weeksToRace < req.durationWeeks) {
      durationNote = `Race day is only ${weeksToRace} weeks away but ${req.durationWeeks} weeks were requested. ` +
        `Build the plan so week ${weeksToRace} is race week.`;
    }
  }

  const demand = buildRaceDemandBlock({
    distanceKm: req.raceDistanceKm,
    elevationGainM: req.raceElevationGainM,
    terrainAccess: req.terrainAccess,
    climb,
  });
  const text = [
    '## RACE BRIEF',
    `- Race: ${req.targetRace || 'none named'}${req.raceDate ? ` on ${req.raceDate}` : ''}.`,
    distanceKm ? `- Distance ${distanceKm} km${elevationGainM ? `, ${elevationGainM} m climbing (${vertPerKm} m/km)` : ''}.` : '',
    weeksToRace ? `- ${weeksToRace} weeks from plan start to race week.` : '',
    durationNote ? `- ⚠️ ${durationNote}` : '',
    req.targetTime ? `- Target time: ${req.targetTime}.` : '',
    demand,
  ].filter(Boolean).join('\n');

  return { distanceKm, elevationGainM, vertPerKm, weeksToRace, durationNote, hasElevation, text };
}

// ---------------------------------------------------------------------------
// Step 3 — research, one search per need
// ---------------------------------------------------------------------------

/** The needs this race and athlete create, each with the query that answers it. */
export function researchNeeds(req: BuildRequest, race: RaceBrief, injuryHistory: string | null): { need: string; query: string }[] {
  const needs: { need: string; query: string }[] = [
    { need: 'Periodization', query: `${req.planType} training periodization base build specific peak phases weekly structure` },
    { need: 'Strength for runners', query: 'strength training for runners progression by training phase frequency' },
  ];
  if (race.hasElevation && (race.vertPerKm ?? 0) >= 20) {
    needs.push(
      { need: 'Climbing and power hiking', query: 'uphill running power hiking steep climbs technique training sessions' },
      { need: 'Vertical progression', query: 'vertical gain weekly progression mountain race training load' },
      { need: 'Descending', query: 'downhill running eccentric strength quadriceps muscular endurance' },
    );
  }
  if ((race.distanceKm ?? 0) >= 15 || /half|marathon|trail|mountain/i.test(req.planType)) {
    needs.push({ need: 'Long run', query: 'long run progression time on feet endurance building' });
  }
  if (req.raceDate || req.targetRace) {
    needs.push({ need: 'Taper', query: 'taper before race reduce volume maintain intensity final weeks' });
  }
  if (injuryHistory && /plantar|fasci|achilles|calf|shin/i.test(injuryHistory)) {
    needs.push({ need: 'Injury history', query: 'plantar fasciitis runner calf foot strengthening prevention load management' });
  }
  return needs;
}

async function research(
  userId: string, req: BuildRequest, race: RaceBrief, profile: AthleteProfile | null,
): Promise<Research> {
  const contextQuery = `Create a ${req.durationWeeks}-week ${req.planType} training plan for ${req.targetRace || 'general fitness'}`;
  const needs = researchNeeds(req, race, profile?.injury_history ?? null);

  const [context, intake, exemplars, macro, ...found] = await Promise.all([
    buildContext(userId, contextQuery, 'plan_generation', { profile }),
    buildPlanGenerationContext(userId, {
      raceDate: req.raceDate, targetTime: req.targetTime, recentRaceResult: req.recentRaceResult,
      currentWeeklyKm: req.currentWeeklyKm, addressesWhat: req.addressesWhat, limitations: req.limitations,
    }),
    exemplarsForRequest({
      planType: req.planType, raceDistanceKm: req.raceDistanceKm, raceElevationGainM: req.raceElevationGainM,
      goalText: [req.targetRace, req.notes, profile?.current_goal].filter(Boolean).join(' '),
      age: profile?.age ?? null,
    }).catch(() => ({ structureNames: [] as string[], strengthName: null, text: '' })),
    resolveMacroContext(userId, req.macroPlanId, req.blockNumber),
    ...needs.map((n) => retrieveBookContext(n.query, {}, 1200, userId).catch(() => null)),
  ]);

  const needResults = needs.map((n, i) => {
    const r = found[i];
    return {
      ...n,
      excerpt: r ? r.text.replace(/^##\s*Methodology Guidelines\s*/i, '').trim() : '',
      sources: r ? [...new Set(r.sources.map((s) => s.bookTitle))] : [],
    };
  });

  return {
    needs: needResults,
    coachContext: buildCoachDynamicBlock(context),
    exemplarsText: exemplars.text,
    exemplarNames: [...exemplars.structureNames, ...(exemplars.strengthName ? [exemplars.strengthName] : [])],
    macroText: macro.text,
    macroPlanId: macro.macroPlanId,
    macroPhase: macro.phaseName,
    intakeBlock: intake.intakeBlock,
    raceDemandBlock: race.text,
    bookSources: [...new Set([...context.bookContext.sources.map((s) => s.bookTitle), ...needResults.flatMap((n) => n.sources)])],
  };
}

/** Render step 3 for a prompt. */
export function formatResearch(r: Research): string {
  const blocks = r.needs
    .filter((n) => n.excerpt && !/No book context available/i.test(n.excerpt))
    .map((n) => `### ${n.need}\n_Sources: ${n.sources.join(', ') || 'none'}_\n${n.excerpt}`);
  return blocks.length
    ? `## TARGETED RESEARCH — WHAT THE METHODOLOGY SAYS ABOUT EACH NEED\n\n${blocks.join('\n\n')}`
    : '## TARGETED RESEARCH\nNo methodology matched these needs. Say so in the rationale rather than citing books.';
}

/**
 * Season context for a block. Falls back to none rather than a guessed phase:
 * a standalone block is valid; a block told it serves the wrong phase builds
 * the wrong thing confidently. Same rule as the single-call generator.
 */
async function resolveMacroContext(
  userId: string, macroPlanId: string | undefined, blockNumber: number | undefined,
): Promise<{ text: string; phaseName: string | null; macroPlanId: string | null }> {
  if (!macroPlanId) return { text: '', phaseName: null, macroPlanId: null };
  const macro = await getActiveMacroPlan(userId);
  if (!macro || macro.id !== macroPlanId) return { text: '', phaseName: null, macroPlanId: null };
  const seasonWeek = blockNumber ? (blockNumber - 1) * 12 + 1 : 1;
  return { text: formatMacroPlan(macro, seasonWeek), phaseName: phaseForWeek(macro, seasonWeek)?.name ?? null, macroPlanId: macro.id };
}

export async function prepare(userId: string, req: BuildRequest): Promise<PreparedStage> {
  const profile = await getAthleteProfile(userId);
  // One training-state assembly feeds both briefs: the climb baseline in the
  // race gap is the same "his climbing" the athlete brief reports.
  const state = await buildTrainingState(userId, { profile });
  const hasElevation = !!req.raceElevationGainM && req.raceElevationGainM > 0;
  const startDate = planStartSunday(userDateStr());
  const partial = state.weeks.find((w) => w.isPartial);
  const weekOneSoFar = partial && partial.weekStart === startDate && partial.runs > 0
    ? { runs: partial.runs, km: partial.km } : null;
  const race = understandRace(req, hasElevation ? state.climb : undefined, startDate);
  const [athlete, researched] = await Promise.all([
    assessAthlete(userId, req, state, profile),
    research(userId, req, race, profile),
  ]);

  const days = athlete.allowedDays;
  const trainingDaysText = days
    ? (req.trainingDayNotes ? `${days.join(', ')} (${req.trainingDayNotes})` : days.join(', '))
    : null;

  return { startDate, weekOneSoFar, athlete, race, research: researched, trainingDaysText };
}
