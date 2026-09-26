/**
 * Pure glue between the builder's model steps: validate the outline, split it
 * into writable chunks, read a writer's weeks back, and assemble the final
 * plan. No I/O, so every seam is testable.
 */

import type { PlanWeek, PlannedStrength } from '@/lib/db/types';
import { extractJson } from '@/lib/coach/plan-output';
import { expandStrengthRefs } from '@/lib/coach/plan-strength';
import { DAYS } from './checks';
import type { BuildReport, OutlinePhase, OutlineWeek, PlanOutline } from './types';
import type { WriteChunk } from './prompts';

/**
 * Longest stretch one writer produces. 4 weeks is ~6k output tokens — about a
 * minute — and short enough that the writer still reasons about each week
 * rather than pattern-filling, which is what degraded the back half of the
 * single-call plans.
 */
export const MAX_CHUNK_WEEKS = 4;

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x : fallback);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

/**
 * Validate and normalise the model's outline. `fatal` problems mean the
 * outline cannot be written from (weeks missing, no phases); the rest are
 * repaired here and reported.
 */
export function normalizeOutline(
  raw: unknown,
  opts: { durationWeeks: number; allowedDays: string[] | null; hasElevation: boolean },
): { outline: PlanOutline | null; fatal: string[]; repaired: string[] } {
  const fatal: string[] = [];
  const repaired: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;

  const library: Record<string, PlannedStrength> = {};
  const rawLib = (o.strength_sessions ?? {}) as Record<string, unknown>;
  // The outline NAMES sessions; exercises are written afterwards by the
  // strength writer (see buildStrengthPrompt). A named session with no
  // exercises is therefore valid here — one with no name is not.
  for (const [id, s] of Object.entries(rawLib)) {
    const sess = s as Partial<PlannedStrength>;
    if (sess && typeof sess === 'object' && typeof sess.name === 'string' && sess.name) {
      library[id] = { ...sess, name: sess.name, exercises: Array.isArray(sess.exercises) ? sess.exercises : [] };
    } else {
      repaired.push(`strength session "${id}" had no name and was dropped`);
    }
  }

  const phases: OutlinePhase[] = (Array.isArray(o.phases) ? o.phases : []).map((p: Record<string, unknown>) => ({
    name: str(p.name, 'Phase'),
    start_week: num(p.start_week) ?? 0,
    end_week: num(p.end_week) ?? 0,
    purpose: str(p.purpose),
    key_sessions: strs(p.key_sessions),
    strength_focus: str(p.strength_focus),
    exit_criteria: strs(p.exit_criteria),
  })).filter((p) => p.start_week >= 1 && p.end_week >= p.start_week);
  if (phases.length === 0) fatal.push('the outline has no valid phases');

  const weekMap = new Map<number, OutlineWeek>();
  for (const w of (Array.isArray(o.weeks) ? o.weeks : []) as Record<string, unknown>[]) {
    const n = num(w.week);
    if (!n || n < 1 || n > opts.durationWeeks) continue;
    const ids = strs(w.strength);
    const known = ids.filter((id) => id in library);
    if (known.length !== ids.length) repaired.push(`week ${n} referenced undefined strength ${ids.filter((i) => !(i in library)).join(', ')}`);
    const km = num(w.total_km);
    if (km === null) { fatal.push(`week ${n} has no total_km`); continue; }
    weekMap.set(n, {
      week: n,
      phase: str(w.phase) || phases.find((p) => n >= p.start_week && n <= p.end_week)?.name || 'Phase',
      focus: str(w.focus),
      total_km: km,
      total_elevation_gain_m: opts.hasElevation ? num(w.total_elevation_gain_m) : null,
      long_run_km: num(w.long_run_km) ?? 0,
      is_recovery: w.is_recovery === true,
      quality_sessions: num(w.quality_sessions) ?? 0,
      strength: known,
    });
  }
  for (let n = 1; n <= opts.durationWeeks; n++) if (!weekMap.has(n)) fatal.push(`week ${n} is missing from the outline`);
  if (opts.hasElevation && [...weekMap.values()].some((w) => w.total_elevation_gain_m == null)) {
    fatal.push('an elevation-targeted outline must give every week a climbing target');
  }

  const dayRoles: Record<string, string> = {};
  for (const [d, r] of Object.entries((o.day_roles ?? {}) as Record<string, unknown>)) {
    if (!(DAYS as readonly string[]).includes(d)) continue;
    if (opts.allowedDays && !opts.allowedDays.includes(d)) { repaired.push(`day role on ${d}, not a training day, was dropped`); continue; }
    dayRoles[d] = str(r);
  }

  if (fatal.length) return { outline: null, fatal, repaired };
  return {
    outline: {
      plan_name: str(o.plan_name, 'Training plan'),
      methodology: str(o.methodology),
      goal: str(o.goal),
      rationale: str(o.rationale),
      sources: strs(o.sources),
      day_roles: dayRoles,
      phases,
      weeks: [...weekMap.values()].sort((a, b) => a.week - b.week),
      strength_sessions: library,
      decisions: strs(o.decisions),
    },
    fatal,
    repaired,
  };
}

/**
 * Split the plan into chunks of at most MAX_CHUNK_WEEKS, never crossing a
 * phase boundary — a writer owns one phase's intent. A 6-week phase becomes
 * 3+3, not 4+2, so neither writer gets a stub.
 */
export function chunksFor(outline: PlanOutline): WriteChunk[] {
  const chunks: WriteChunk[] = [];
  let i = 0;
  const weeks = outline.weeks;
  while (i < weeks.length) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1].phase === weeks[i].phase) j++;
    const run = weeks.slice(i, j + 1).map((w) => w.week);
    const parts = Math.ceil(run.length / MAX_CHUNK_WEEKS);
    const size = Math.ceil(run.length / parts);
    for (let k = 0; k < run.length; k += size) chunks.push({ phase: weeks[i].phase, weeks: run.slice(k, k + size) });
    i = j + 1;
  }
  return chunks;
}

/** The chunks that contain any of these weeks. */
export function chunksContaining(chunks: WriteChunk[], weeks: number[]): WriteChunk[] {
  return chunks.filter((c) => c.weeks.some((w) => weeks.includes(w)));
}

/** Read a writer's weeks back. Refuses a response that does not cover its chunk exactly. */
export function parseWriterWeeks(
  text: string,
  chunk: WriteChunk,
  finishReason?: string | null,
): { ok: true; weeks: PlanWeek[] } | { ok: false; error: string } {
  if (finishReason === 'length') return { ok: false, error: `weeks ${chunk.weeks.join(',')} were cut off at the length limit` };
  let parsed: unknown;
  try { parsed = extractJson(text); } catch (e) {
    return { ok: false, error: `weeks ${chunk.weeks.join(',')}: unreadable JSON (${e instanceof Error ? e.message : 'parse error'})` };
  }
  const list = (parsed as { weeks?: unknown }).weeks;
  if (!Array.isArray(list)) return { ok: false, error: `weeks ${chunk.weeks.join(',')}: no "weeks" array` };
  const weeks = (list as PlanWeek[]).filter((w) => chunk.weeks.includes(Number(w.week_number)));
  const got = new Set(weeks.map((w) => Number(w.week_number)));
  const missing = chunk.weeks.filter((n) => !got.has(n));
  if (missing.length) return { ok: false, error: `writer returned no week ${missing.join(', ')}` };
  return {
    ok: true,
    weeks: weeks.map((w) => ({
      ...w,
      week_number: Number(w.week_number),
      total_km: num(w.total_km) ?? 0,
      phase: w.phase || chunk.phase,
      workouts: w.workouts ?? {},
    })),
  };
}

/** Replace weeks by number, keeping the rest. */
export function mergeWeeks(current: PlanWeek[], replacement: PlanWeek[]): PlanWeek[] {
  const byNum = new Map(current.map((w) => [w.week_number, w]));
  for (const w of replacement) byNum.set(w.week_number, w);
  return [...byNum.values()].sort((a, b) => a.week_number - b.week_number);
}

/** The saved plan: the old PlanData shape, plus how it was built. */
export function assemblePlan(
  outline: PlanOutline,
  weeks: PlanWeek[],
  durationWeeks: number,
  report: BuildReport,
): Record<string, unknown> {
  const count = (pred: (p: OutlinePhase) => boolean) =>
    outline.phases.filter(pred).reduce((a, p) => a + (p.end_week - p.start_week + 1), 0);
  const plan: Record<string, unknown> = {
    plan_name: outline.plan_name,
    methodology: outline.methodology,
    goal: outline.goal,
    duration_weeks: durationWeeks,
    sources: outline.sources,
    phase_structure: {
      base_weeks: count((p) => /base/i.test(p.name)),
      support_weeks: count((p) => /support|build/i.test(p.name)),
      specific_weeks: count((p) => /specific|peak/i.test(p.name)),
      taper_weeks: count((p) => /taper/i.test(p.name)),
    },
    strength_sessions: outline.strength_sessions,
    weeks: JSON.parse(JSON.stringify(weeks)),
    build_report: report,
  };
  // Same expansion the single-call path uses, so every reader downstream
  // (card, adjust, watch push) sees full strength objects.
  expandStrengthRefs(plan as Parameters<typeof expandStrengthRefs>[0]);
  return plan;
}

/**
 * Merge the strength writer's exercises into the outline's named sessions.
 * Only ids the outline defined are accepted — the writer cannot add sessions
 * the weeks never reference. Returns the ids still without exercises.
 */
export function mergeStrength(
  library: Record<string, PlannedStrength>,
  raw: unknown,
): { library: Record<string, PlannedStrength>; missing: string[] } {
  const written = ((raw ?? {}) as { strength_sessions?: Record<string, Partial<PlannedStrength>> }).strength_sessions ?? {};
  const out: Record<string, PlannedStrength> = {};
  for (const [id, base] of Object.entries(library)) {
    const w = written[id];
    const exercises = Array.isArray(w?.exercises) ? w!.exercises.filter((e) => e && typeof e.exercise === 'string') : [];
    out[id] = exercises.length
      ? { ...base, duration_minutes: w?.duration_minutes ?? base.duration_minutes, exercises }
      : base;
  }
  return { library: out, missing: Object.keys(out).filter((id) => out[id].exercises.length === 0) };
}
