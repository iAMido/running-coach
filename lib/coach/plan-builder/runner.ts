/**
 * The staged plan builder's stage machine.
 *
 *   created ──prepare──▶ prepared ──outline──▶ outlined ──write──▶ written
 *     ──check──▶ checked ──review──▶ (coherence_fix ──▶ checked)* ──▶ reviewed
 *     ──save──▶ done
 *
 * `advance` runs exactly ONE stage and persists its output, so each HTTP
 * request stays far inside the 300 s function limit — the outline and the
 * review run on Opus 5.5, whose thinking cannot be switched off, and the
 * single-call generator already spent ~150 s of that limit on its own.
 *
 * Nothing touches training_plans until the final save stage, and the save
 * stage runs only when every earlier stage succeeded. A failed build leaves
 * the athlete's current plan exactly as it was.
 */

import { supabase } from '@/lib/db/supabase';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { recordPhaseBuilt } from '@/lib/coach/macro-plan';
import { getAthleteProfile } from '@/lib/db/profile';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { extractJson, planOutputTokenBudget } from '@/lib/coach/plan-output';
import type { PlanWeek } from '@/lib/db/types';
import { prepare } from './prepare';
import { ask, Meter } from './llm';
import { buildOutlinePrompt, buildReviewPrompt, buildStrengthPrompt, buildWriterPrompt, type WriteChunk } from './prompts';
import { assemblePlan, chunksFor, mergeStrength, mergeWeeks, narrowChunks, normalizeOutline, parseWriterWeeks } from './assemble';
import { checkCoherence, checkPlan, type CheckContext } from './checks';
import { STAGE_LABELS } from './view';
import { runSeasonStage } from './season';
import type {
  BuildKind, BuildReport, BuildRequest, BuildStage, CheckReport, CoherenceIssue, CoherenceReview, PlanBuildRow, PlanOutline, SeasonRequest,
} from './types';

/** A claimed stage is abandoned after this — longer than any stage can run. */
const CLAIM_MS = 290_000;
/** Review → fix rounds. "At most twice" so a disagreement cannot loop. */
export const MAX_REVIEW_ROUNDS = 2;
/** Rule-check repair rounds inside one check stage. */
const MAX_REPAIR_ROUNDS = 2;
const MAX_ATTEMPTS = 2;

export { STAGE_LABELS } from './view';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function createBuild(
  userId: string, request: BuildRequest | SeasonRequest, opts: { dryRun?: boolean; kind?: BuildKind } = {},
): Promise<PlanBuildRow> {
  const { data, error } = await supabase.from('plan_builds')
    .insert({ user_id: userId, request, dry_run: !!opts.dryRun, kind: opts.kind ?? 'block' })
    .select().single();
  if (error) throw new Error(`could not start build: ${error.message}`);
  return data as PlanBuildRow;
}

export async function getBuild(userId: string, id: string): Promise<PlanBuildRow | null> {
  const { data } = await supabase.from('plan_builds').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  return (data as PlanBuildRow) ?? null;
}

/** The athlete's unfinished build of this kind from the last hour, for resuming after a page reload. */
export async function latestOpenBuild(userId: string, kind: BuildKind = 'block'): Promise<PlanBuildRow | null> {
  const { data } = await supabase.from('plan_builds').select('*')
    .eq('user_id', userId).eq('dry_run', false).eq('kind', kind)
    .not('stage', 'in', '(done,failed)')
    .gte('updated_at', new Date(Date.now() - 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as PlanBuildRow) ?? null;
}

async function claim(row: PlanBuildRow): Promise<boolean> {
  const now = new Date();
  const { data } = await supabase.from('plan_builds')
    .update({ running_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
    .eq('id', row.id).eq('stage', row.stage)
    .or(`running_until.is.null,running_until.lt.${now.toISOString()}`)
    .select('id');
  return !!data && data.length > 0;
}

async function commit(row: PlanBuildRow, patch: Partial<PlanBuildRow>): Promise<PlanBuildRow> {
  const { data, error } = await supabase.from('plan_builds')
    .update({ ...patch, running_until: null, updated_at: new Date().toISOString() })
    .eq('id', row.id).select().single();
  if (error) throw new Error(`could not save build stage: ${error.message}`);
  return data as PlanBuildRow;
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

type StageResult = Partial<PlanBuildRow>;

function checkContext(row: PlanBuildRow, zones: CheckContext['zones']): CheckContext {
  const req = row.request, prep = row.prepared!;
  return {
    expectedWeeks: req.durationWeeks,
    allowedDays: prep.athlete.allowedDays,
    runsPerWeek: req.runsPerWeek,
    hasElevation: prep.race.hasElevation,
    hasRace: !!(req.targetRace || req.raceDate) && !prep.race.durationNote?.includes('ends before'),
    outline: row.outline,
    athlete: prep.athlete,
    zones,
    strengthLibrary: Object.keys(row.outline?.strength_sessions ?? {}),
    phaseRanges: prep.research.phaseRanges ?? null,
  };
}

async function zonesFor(userId: string) {
  return parseZonesFromProfile(await getAthleteProfile(userId));
}

/** Write (or rewrite) chunks in parallel. Each chunk gets one retry. */
async function writeChunks(
  row: PlanBuildRow,
  chunks: WriteChunk[],
  fixes: Map<WriteChunk, string[]> | undefined,
  meter: Meter,
): Promise<{ weeks: PlanWeek[]; failures: string[]; ms: number; tokens: number }> {
  const t = Date.now();
  let tokens = 0;
  const results = await Promise.all(chunks.map(async (chunk) => {
    const problems = fixes?.get(chunk);
    const current = problems ? (row.weeks ?? []).filter((w) => chunk.weeks.includes(w.week_number)) : undefined;
    const { shared, system, user } = buildWriterPrompt(row.request, row.prepared!, row.outline!, chunk,
      problems ? { problems, current: current! } : undefined);
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await ask(row.user_id, 'plan_writer', system, user, planOutputTokenBudget(chunk.weeks.length), meter, shared);
      tokens += r.completionTokens ?? 0;
      if (r.error) { lastError = r.error; continue; }
      const parsed = parseWriterWeeks(r.content, chunk, r.finishReason);
      if (parsed.ok) return { weeks: parsed.weeks, error: null };
      lastError = parsed.error;
    }
    return { weeks: [] as PlanWeek[], error: lastError };
  }));
  return {
    weeks: results.flatMap((r) => r.weeks),
    failures: results.map((r) => r.error).filter((e): e is string => !!e),
    ms: Date.now() - t,
    tokens,
  };
}

/**
 * Put the writers' shared context in the prompt cache before they start.
 *
 * The first-draft writers all start at once, so without this none of them
 * can read the cache — each pays full price (x1.25 for the cache write) for
 * the same ~25k-token context. Measured 2026-09-27: $1.05 of a $3.34 build.
 * One 1-token call writes the cache; the writers then read it at ~10%.
 * Costs a few seconds. Best-effort — a failed prime only loses the saving.
 */
async function primeWriterCache(row: PlanBuildRow, chunk: WriteChunk, meter: Meter): Promise<void> {
  const { shared } = buildWriterPrompt(row.request, row.prepared!, row.outline!, chunk);
  try {
    await ask(row.user_id, 'plan_writer', 'Cache warm-up. Reply with the single word OK.', 'OK?', 1, meter, shared);
  } catch { /* the writers still run, just without the cache */ }
}

/** Exercises for the outline's named strength sessions. One retry. */
async function writeStrength(row: PlanBuildRow, meter: Meter): Promise<{ library: PlanOutline['strength_sessions']; missing: string[]; tokens: number }> {
  let library = row.outline!.strength_sessions;
  if (Object.keys(library).length === 0) return { library, missing: [], tokens: 0 };
  const { system, user } = buildStrengthPrompt(row.request, row.prepared!, row.outline!);
  let tokens = 0;
  let missing = Object.keys(library);
  for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
    const r = await ask(row.user_id, 'plan_writer', system, user, 8_000, meter);
    tokens += r.completionTokens ?? 0;
    if (r.error || r.finishReason === 'length') continue;
    try {
      const merged = mergeStrength(library, extractJson(r.content));
      library = merged.library;
      missing = merged.missing;
    } catch { /* unreadable — retry */ }
  }
  return { library, missing, tokens };
}

/** Rule errors → rewrite the chunks that hold them → recheck. Up to MAX_REPAIR_ROUNDS. */
async function checkAndRepair(
  row: PlanBuildRow, weeks: PlanWeek[], ctx: CheckContext, prior: CheckReport | null, meter: Meter,
): Promise<{ weeks: PlanWeek[]; report: CheckReport; tokens: number }> {
  const repairs = [...(prior?.repairs ?? [])];
  let tokens = 0;
  let violations = checkPlan(weeks, ctx);
  const chunks = chunksFor(row.outline!);
  for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
    const errors = violations.filter((v) => v.severity === 'error');
    if (errors.length === 0) break;
    const errorWeeks = [...new Set(errors.map((e) => e.week).filter((w): w is number => w !== null))];
    const targets = narrowChunks(chunks, errorWeeks);
    if (targets.length === 0) break;
    const fixes = new Map(targets.map((c) => [c, errors
      .filter((e) => e.week !== null && c.weeks.includes(e.week))
      .map((e) => `Week ${e.week}${e.day ? ` ${e.day}` : ''}: ${e.message}`)]));
    const res = await writeChunks({ ...row, weeks }, targets, fixes, meter);
    tokens += res.tokens;
    if (res.weeks.length === 0) break;
    weeks = mergeWeeks(weeks, res.weeks);
    const next = checkPlan(weeks, ctx);
    repairs.push({
      round: repairs.length + 1, weeks: res.weeks.map((w) => w.week_number),
      errorsBefore: errors.length, errorsAfter: next.filter((v) => v.severity === 'error').length,
    });
    violations = next;
  }
  return {
    weeks,
    report: {
      violations,
      errors: violations.filter((v) => v.severity === 'error').length,
      warnings: violations.filter((v) => v.severity === 'warn').length,
      repairs,
    },
    tokens,
  };
}

async function runStage(row: PlanBuildRow): Promise<StageResult> {
  if (row.kind === 'season') return runSeasonStage(row);
  const t = Date.now();
  const timings = { ...row.timings };
  const attempts = { ...(row.attempts ?? {}) };
  const meter = new Meter();
  const note = (k: string, extra: { tokens?: number; thinking?: number } = {}) => { timings[k] = { ms: Date.now() - t, ...extra, ...meter.summary }; };

  switch (row.stage) {
    case 'created': {
      const prepared = await prepare(row.user_id, row.request);
      note('prepare');
      return { stage: 'prepared', prepared, timings };
    }

    case 'prepared': {
      const { system, user } = buildOutlinePrompt(row.request, row.prepared!);
      const r = await ask(row.user_id, 'plan_outline', system, user, 8_000, meter);
      note('outline', { tokens: r.completionTokens ?? undefined, thinking: r.reasoningTokensUsed ?? undefined });
      let problem = r.error ?? (r.finishReason === 'length' ? 'the outline was cut off at the length limit' : null);
      if (!problem) {
        try {
          const n = normalizeOutline(extractJson(r.content), {
            durationWeeks: row.request.durationWeeks,
            allowedDays: row.prepared!.athlete.allowedDays,
            hasElevation: row.prepared!.race.hasElevation,
          });
          if (n.outline) {
            n.outline.repaired = n.repaired;
            return { stage: 'outlined', outline: n.outline, timings, error: null };
          }
          problem = n.fatal.join('; ');
        } catch (e) {
          problem = `unreadable outline (${e instanceof Error ? e.message : 'parse error'})`;
        }
      }
      attempts.outline = (attempts.outline ?? 0) + 1;
      if (attempts.outline >= MAX_ATTEMPTS) return { stage: 'failed', error: `Outline failed twice: ${problem}`, attempts, timings };
      return { error: `Outline attempt ${attempts.outline} unusable (${problem}); retrying.`, attempts, timings };
    }

    case 'outlined': {
      // Phases and the strength programme's exercises are independent given
      // the outline — write them all at once.
      const chunks = chunksFor(row.outline!);
      await primeWriterCache(row, chunks[0], meter);
      const [res, strength] = await Promise.all([writeChunks(row, chunks, undefined, meter), writeStrength(row, meter)]);
      note('write', { tokens: res.tokens + strength.tokens });
      if (strength.missing.length) res.failures.push(`strength sessions without exercises: ${strength.missing.join(', ')}`);
      if (res.failures.length) {
        attempts.write = (attempts.write ?? 0) + 1;
        if (attempts.write >= MAX_ATTEMPTS) return { stage: 'failed', error: `Writing failed: ${res.failures.join('; ')}`, attempts, timings };
        return { error: `Writing incomplete (${res.failures.join('; ')}); retrying.`, attempts, timings };
      }
      return {
        stage: 'written', weeks: mergeWeeks([], res.weeks), timings, error: null,
        outline: { ...row.outline!, strength_sessions: strength.library },
      };
    }

    case 'written': {
      const ctx = checkContext(row, await zonesFor(row.user_id));
      const { weeks, report, tokens } = await checkAndRepair(row, row.weeks!, ctx, null, meter);
      note('check', { tokens });
      return { stage: 'checked', weeks, checks: report, timings };
    }

    case 'checked': {
      const round = row.review_rounds + 1;
      const measured = checkCoherence(row.weeks!, row.outline!, { hasElevation: row.prepared!.race.hasElevation });
      const remaining = (row.checks?.violations ?? []).filter((v) => v.severity === 'error');
      const { system, user } = buildReviewPrompt(row.request, row.prepared!, row.outline!, row.weeks!, measured, remaining);
      const r = await ask(row.user_id, 'plan_review', system, user, 4_000, meter);
      note(`review_${round}`, { tokens: r.completionTokens ?? undefined, thinking: r.reasoningTokensUsed ?? undefined });

      let coach: CoherenceIssue[] = [];
      let verdict: CoherenceReview['verdict'] = 'coherent';
      let summary = '';
      if (!r.error && r.finishReason !== 'length') {
        try {
          const j = extractJson(r.content) as { verdict?: string; summary?: string; issues?: Partial<CoherenceIssue>[] };
          summary = j.summary ?? '';
          verdict = j.verdict === 'needs_changes' ? 'needs_changes' : 'coherent';
          coach = (j.issues ?? []).slice(0, 6).map((i) => ({
            severity: (i.severity === 'must_fix' ? 'must_fix' : 'note') as CoherenceIssue['severity'],
            weeks: (i.weeks ?? []).filter((w) => Number.isInteger(w) && w >= 1 && w <= row.request.durationWeeks),
            problem: String(i.problem ?? ''), fix: String(i.fix ?? ''), source: 'coach' as const,
          })).filter((i) => i.problem);
        } catch { summary = 'The head coach review could not be read; measured checks still applied.'; }
      } else {
        // A failed review must not block the plan — the measured checks
        // already ran. Record it and carry on.
        summary = `Head coach review unavailable (${r.error ?? 'cut off'}); measured checks still applied.`;
      }
      const issues = [...measured, ...coach];
      const mustFix = issues.filter((i) => i.severity === 'must_fix' && i.weeks.length > 0);
      const review: CoherenceReview = { round, verdict: mustFix.length ? 'needs_changes' : verdict, summary, issues };
      const next: BuildStage = mustFix.length > 0 && round <= MAX_REVIEW_ROUNDS ? 'coherence_fix' : 'reviewed';
      return { stage: next, reviews: [...row.reviews, review], review_rounds: round, timings };
    }

    case 'coherence_fix': {
      const last = row.reviews[row.reviews.length - 1];
      const mustFix = last.issues.filter((i) => i.severity === 'must_fix' && i.weeks.length > 0);
      const chunks = chunksFor(row.outline!);
      const targets = narrowChunks(chunks, mustFix.flatMap((i) => i.weeks));
      const fixes = new Map(targets.map((c) => [c, mustFix
        .filter((i) => i.weeks.some((w) => c.weeks.includes(w)))
        .map((i) => `${i.problem} FIX: ${i.fix}`)]));
      const res = await writeChunks(row, targets, fixes, meter);
      let weeks = res.weeks.length ? mergeWeeks(row.weeks!, res.weeks) : row.weeks!;
      const ctx = checkContext(row, await zonesFor(row.user_id));
      const checked = await checkAndRepair({ ...row, weeks }, weeks, ctx, row.checks, meter);
      weeks = checked.weeks;
      note(`fix_${row.review_rounds}`, { tokens: res.tokens + checked.tokens });
      const next: BuildStage = row.review_rounds < MAX_REVIEW_ROUNDS ? 'checked' : 'reviewed';
      const reviews = row.reviews.map((r, i) => (i === row.reviews.length - 1 ? { ...r, fixApplied: true } : r));
      return { stage: next, weeks, checks: checked.report, reviews, timings };
    }

    case 'reviewed': {
      const report = buildReport(row);
      const planJson = assemblePlan(row.outline!, row.weeks!, row.request.durationWeeks, report);
      if (row.dry_run) {
        note('save');
        return { stage: 'done', timings, weeks: planJson.weeks as PlanWeek[] };
      }
      // Retire the current plan only now, with the replacement fully built.
      await supabase.from('training_plans').update({ status: 'completed' }).eq('user_id', row.user_id).eq('status', 'active');
      const { data: plan, error } = await supabase.from('training_plans').insert({
        user_id: row.user_id,
        plan_type: row.request.planType,
        plan_json: planJson,
        duration_weeks: row.request.durationWeeks,
        // The Sunday the outline was written for — never "today".
        start_date: row.prepared!.startDate,
        current_week_num: 1,
        status: 'active',
        macro_plan_id: row.prepared!.research.macroPlanId,
        block_number: row.request.phaseNumber ?? row.request.blockNumber ?? null,
        macro_phase: row.prepared!.research.macroPhase,
      }).select('id').single();
      if (error) throw new Error(`saving the plan failed: ${error.message}`);
      // One plan per season phase: record that this phase is now active (and
      // the previous one done), so the season knows where the athlete really is.
      if (row.prepared!.research.macroPlanId && row.prepared!.research.phaseNumber) {
        await recordPhaseBuilt(row.prepared!.research.macroPlanId, row.prepared!.research.phaseNumber, {
          planId: plan.id, startDate: row.prepared!.startDate, extensionWeeks: row.request.extensionWeeks ?? 0,
        }).catch((e) => console.error('season progress not recorded:', e));
      }
      note('save');
      return { stage: 'done', plan_id: plan.id, timings };
    }

    default:
      return {};
  }
}

function buildReport(row: PlanBuildRow): BuildReport {
  // "Addressed" means a must-fix was handed to a writer and those weeks were
  // rewritten — then rule-checked, and re-reviewed unless it was the final
  // round. It is deliberately not called "fixed": the last round's rewrite is
  // not reviewed again, and the report must not claim more than happened.
  const addressed = row.reviews
    .filter((r) => r.fixApplied)
    .flatMap((r) => r.issues.filter((i) => i.severity === 'must_fix' && i.weeks.length > 0));
  const last = row.reviews[row.reviews.length - 1];
  const open = last && !last.fixApplied
    ? last.issues
    : (last?.issues ?? []).filter((i) => i.severity === 'note');
  const notes: string[] = [];
  if (row.prepared?.athlete.dayMismatch) notes.push(row.prepared.athlete.dayMismatch);
  if (row.prepared?.race.durationNote) notes.push(row.prepared.race.durationNote);
  return {
    build_id: row.id,
    rationale: row.outline?.rationale ?? '',
    phases: row.outline?.phases ?? [],
    decisions: row.outline?.decisions ?? [],
    athlete_notes: notes,
    checks: {
      errors: row.checks?.errors ?? 0,
      warnings: row.checks?.warnings ?? 0,
      repaired_weeks: [...new Set((row.checks?.repairs ?? []).flatMap((r) => r.weeks))].sort((a, b) => a - b),
      remaining: (row.checks?.violations ?? []).slice(0, 40),
    },
    coherence: {
      rounds: row.review_rounds,
      verdict: last?.verdict ?? 'not reviewed',
      summary: last?.summary ?? '',
      addressed,
      open,
    },
    models: { outline: MODEL_FOR.plan_outline, writer: MODEL_FOR.plan_writer, review: MODEL_FOR.plan_review },
    seconds: Math.round(Object.values(row.timings).reduce((a, x) => a + x.ms, 0) / 1000),
  };
}

/**
 * Run the build's next stage. Returns the row as it stands afterwards. When
 * another request already holds the stage, returns the row unchanged with
 * `busy: true` — the caller polls instead of paying for the same call twice.
 */
export async function advance(userId: string, buildId: string): Promise<{ row: PlanBuildRow; busy: boolean }> {
  const row = await getBuild(userId, buildId);
  if (!row) throw new Error('build not found');
  if (row.stage === 'done' || row.stage === 'failed') return { row, busy: false };
  if (!(await claim(row))) return { row, busy: true };
  try {
    const patch = await runStage(row);
    return { row: await commit(row, patch), busy: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'stage failed';
    return { row: await commit(row, { stage: 'failed', error: `${STAGE_LABELS[row.stage]}: ${message}` }), busy: false };
  }
}
