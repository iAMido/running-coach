/**
 * One-shot merge of the 6 remaining garmin<->strava duplicate pairs.
 *
 * Context (see docs/intervals-icu-probe-findings.md §6b, category C): six runs
 * were ingested twice, exactly 2.00 hours apart, because the `garmin` rows hold
 * true UTC while the `strava_sync` rows hold Israel local time in a UTC-typed
 * column. Neither copy is strictly better:
 *
 *   garmin (.fit)  -> has pct_z1..pct_z6, no laps, no coach_notes
 *   strava_sync    -> has laps + coach_notes, no zones
 *
 * So this MERGES rather than deletes: null-holes on the strava row are filled
 * from the garmin row, then the (now redundant) garmin row is removed.
 *
 * Safety properties, in order of importance:
 *   - Dry-run by default. Writing requires an explicit --commit.
 *   - Fill-null only. A non-null column on the strava row is never overwritten,
 *     so re-running cannot degrade a row.
 *   - The garmin row is deleted only after a live re-check that it owns zero
 *     laps and zero run_feedback rows. Both FKs are ON DELETE CASCADE, so an
 *     unchecked delete would silently destroy real data.
 *   - Idempotent: after a successful run the garmin side is gone, so the pair
 *     no longer matches and a second run is a no-op.
 *
 * Usage:
 *   bunx tsx scripts/merge-duplicate-runs.ts                    # dry run
 *   bunx tsx scripts/merge-duplicate-runs.ts --commit           # write
 *   bunx tsx scripts/merge-duplicate-runs.ts --env ../../.env.local
 *
 * Expected: 6 pairs on 2025-12-15, 12-18, 12-20, 12-22, 12-26, 12-29.
 * Expected end state: 666 -> 660 runs.
 *
 * APPLIED 2026-08-05. All 6 pairs merged: 666 -> 660 runs, laps unchanged at
 * 483, run_feedback unchanged at 27, orphaned feedback still 1 (the known
 * pre-existing one — nothing cascaded). Re-running now reports zero pairs,
 * which is what idempotency looks like here.
 *
 * The 10 ambiguous 2022 pairs are deliberately out of scope: different
 * filenames, both copies carry zones, neither carries laps.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ---------------------------------------------------------------- config

/** Maximum |Δ| between the two copies of the same run. */
const MAX_HOURS_APART = 3;
/** Distance tolerance: the larger of 50 m and 2% of the longer run. */
const ABS_DISTANCE_TOLERANCE_KM = 0.05;
const REL_DISTANCE_TOLERANCE = 0.02;

const ZONE_COLUMNS = ['pct_z1', 'pct_z2', 'pct_z3', 'pct_z4', 'pct_z5', 'pct_z6'] as const;

// ------------------------------------------------------------------ types

interface RunRow {
  id: string;
  user_id: string | null;
  filename: string | null;
  date: string;
  distance_km: number | null;
  duration_min: number | null;
  data_source: string | null;
  trimp: number | null;
  coach_notes: string | null;
  pct_z1: number | null;
  pct_z2: number | null;
  pct_z3: number | null;
  pct_z4: number | null;
  pct_z5: number | null;
  pct_z6: number | null;
}

type MergePatch = Partial<Record<(typeof ZONE_COLUMNS)[number] | 'trimp' | 'coach_notes', number | string>>;

interface Pair {
  garmin: RunRow;
  strava: RunRow;
  hoursApart: number;
  distanceDeltaKm: number;
}

interface PairOutcome {
  pair: Pair;
  patch: MergePatch;
  /** Populated when the pair was not fully merged. */
  skipReason: string | null;
  lapsOnGarmin: number;
  feedbackOnGarmin: number;
  deleted: boolean;
}

// ------------------------------------------------------------------- args

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');

function argValue(flag: string): string | undefined {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

// ------------------------------------------------------------------- boot

const envPath = path.resolve(process.cwd(), argValue('--env') ?? '.env.local');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    `Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n` +
      `Looked in: ${envPath}\n` +
      `Point at a different file with --env <path>.`,
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'runcoach' },
  auth: { autoRefreshToken: false, persistSession: false },
});

// -------------------------------------------------------------- utilities

/**
 * Absolute-instant math on stored timestamps — not calendar math, so this is
 * timezone-independent and `lib/utils/user-time.ts` does not apply.
 */
function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000;
}

function distancesMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  const tolerance = Math.max(ABS_DISTANCE_TOLERANCE_KM, REL_DISTANCE_TOLERANCE * Math.max(a, b));
  return Math.abs(a - b) <= tolerance;
}

function hasZones(r: RunRow): boolean {
  return ZONE_COLUMNS.some((c) => r[c] != null);
}

function shortDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

// ----------------------------------------------------------------- fetch

async function fetchCandidateRuns(): Promise<RunRow[]> {
  const columns =
    'id,user_id,filename,date,distance_km,duration_min,data_source,trimp,coach_notes,' +
    ZONE_COLUMNS.join(',');

  const rows: RunRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('runs')
      .select(columns)
      .in('data_source', ['garmin', 'strava_sync'])
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Failed to fetch runs: ${error.message}`);
    const page = (data ?? []) as unknown as RunRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function countRuns(): Promise<number> {
  const { count, error } = await supabase.from('runs').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Failed to count runs: ${error.message}`);
  return count ?? 0;
}

async function countRelated(table: 'laps' | 'run_feedback', runId: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);
  if (error) throw new Error(`Failed to count ${table} for run ${runId}: ${error.message}`);
  return count ?? 0;
}

// ------------------------------------------------------------- pair finder

/**
 * Greedy nearest-match pairing. Each garmin row claims at most one strava row
 * and vice versa, so an unexpectedly dense cluster degrades into "some pairs
 * unmatched" rather than fanning out into bogus merges.
 */
function findPairs(runs: RunRow[]): Pair[] {
  const garminRows = runs.filter((r) => r.data_source === 'garmin' && hasZones(r));
  const stravaRows = runs.filter((r) => r.data_source === 'strava_sync');

  const claimed = new Set<string>();
  const pairs: Pair[] = [];

  for (const g of garminRows) {
    let best: Pair | null = null;

    for (const s of stravaRows) {
      if (claimed.has(s.id)) continue;
      if (s.user_id !== g.user_id) continue;

      const hoursApart = hoursBetween(g.date, s.date);
      if (hoursApart > MAX_HOURS_APART) continue;
      if (!distancesMatch(g.distance_km, s.distance_km)) continue;

      const distanceDeltaKm = Math.abs((g.distance_km ?? 0) - (s.distance_km ?? 0));
      const candidate: Pair = { garmin: g, strava: s, hoursApart, distanceDeltaKm };

      if (
        !best ||
        candidate.hoursApart < best.hoursApart ||
        (candidate.hoursApart === best.hoursApart && candidate.distanceDeltaKm < best.distanceDeltaKm)
      ) {
        best = candidate;
      }
    }

    if (best) {
      claimed.add(best.strava.id);
      pairs.push(best);
    }
  }

  return pairs.sort((a, b) => a.strava.date.localeCompare(b.strava.date));
}

/** Fill-null-only patch: what the strava row is missing and the garmin row has. */
function buildPatch(pair: Pair): MergePatch {
  const { garmin, strava } = pair;
  const patch: MergePatch = {};

  for (const col of ZONE_COLUMNS) {
    if (strava[col] == null && garmin[col] != null) patch[col] = garmin[col] as number;
  }
  if (strava.trimp == null && garmin.trimp != null) patch.trimp = garmin.trimp;
  if (strava.coach_notes == null && garmin.coach_notes != null) patch.coach_notes = garmin.coach_notes;

  return patch;
}

// -------------------------------------------------------------------- run

async function main() {
  console.log(`\nmerge-duplicate-runs — ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no writes)'}`);
  console.log(`env: ${envPath}\n`);

  const runsBefore = await countRuns();
  const candidates = await fetchCandidateRuns();
  const pairs = findPairs(candidates);

  console.log(`runs before:        ${runsBefore}`);
  console.log(`garmin+strava rows: ${candidates.length}`);
  console.log(`pairs matched:      ${pairs.length}\n`);

  if (pairs.length === 0) {
    console.log('Nothing to merge. (Already run? The garmin side is deleted on success.)');
    return;
  }

  const outcomes: PairOutcome[] = [];

  for (const pair of pairs) {
    const { garmin, strava } = pair;
    const patch = buildPatch(pair);

    const lapsOnGarmin = await countRelated('laps', garmin.id);
    const feedbackOnGarmin = await countRelated('run_feedback', garmin.id);

    let skipReason: string | null = null;
    // Deleting a row with dependents would cascade them away. Never do that.
    if (lapsOnGarmin > 0) skipReason = `garmin row owns ${lapsOnGarmin} lap(s)`;
    else if (feedbackOnGarmin > 0) skipReason = `garmin row owns ${feedbackOnGarmin} feedback row(s)`;
    // Documented shape is "strava copy has no zones". If it does, the pair is
    // not what the probe described — report it instead of guessing.
    else if (hasZones(strava)) skipReason = 'strava row already has zones — review manually';

    outcomes.push({ pair, patch, skipReason, lapsOnGarmin, feedbackOnGarmin, deleted: false });
  }

  // ---- report

  console.log('PAIRS');
  console.log('-'.repeat(100));
  for (const o of outcomes) {
    const { garmin: g, strava: s } = o.pair;
    const patchKeys = Object.keys(o.patch);
    console.log(
      `${shortDate(s.date)}  ${(s.distance_km ?? 0).toFixed(2)} km  Δ${o.pair.hoursApart.toFixed(2)}h  Δ${o.pair.distanceDeltaKm.toFixed(3)}km`,
    );
    console.log(`   keep   strava_sync  ${s.id}  ${s.filename ?? '(no filename)'}  ${shortDate(s.date)}`);
    console.log(
      `   drop   garmin       ${g.id}  ${g.filename ?? '(no filename)'}  ${shortDate(g.date)}  laps=${o.lapsOnGarmin} feedback=${o.feedbackOnGarmin}`,
    );
    console.log(`   copy   ${patchKeys.length ? patchKeys.join(', ') : '(nothing — target already populated)'}`);
    if (o.skipReason) console.log(`   SKIP   ${o.skipReason}`);
    console.log('');
  }

  const mergeable = outcomes.filter((o) => !o.skipReason);
  const skipped = outcomes.filter((o) => o.skipReason);

  if (!COMMIT) {
    console.log('-'.repeat(100));
    console.log(`would merge:  ${mergeable.length}`);
    console.log(`would skip:   ${skipped.length}`);
    console.log(`runs after:   ${runsBefore} -> ${runsBefore - mergeable.length} (projected)`);
    console.log('\nRe-run with --commit to write.');
    return;
  }

  // ---- write

  console.log('-'.repeat(100));
  for (const o of mergeable) {
    const { garmin, strava } = o.pair;

    if (Object.keys(o.patch).length > 0) {
      const { error } = await supabase.from('runs').update(o.patch).eq('id', strava.id);
      if (error) {
        console.log(`FAILED update ${strava.id}: ${error.message} — leaving the garmin row in place`);
        o.skipReason = `update failed: ${error.message}`;
        continue;
      }
    }

    // Re-check immediately before the delete: the counts above were read at
    // report time, and this is the irreversible step.
    const laps = await countRelated('laps', garmin.id);
    const feedback = await countRelated('run_feedback', garmin.id);
    if (laps > 0 || feedback > 0) {
      console.log(`ABORT delete ${garmin.id}: gained laps=${laps} feedback=${feedback} since the check`);
      o.skipReason = 'dependents appeared before delete';
      continue;
    }

    const { error: delError } = await supabase.from('runs').delete().eq('id', garmin.id);
    if (delError) {
      console.log(`FAILED delete ${garmin.id}: ${delError.message}`);
      o.skipReason = `delete failed: ${delError.message}`;
      continue;
    }

    o.deleted = true;
    console.log(`merged ${shortDate(strava.date)}  ${strava.id}  <- ${garmin.id}`);
  }

  const runsAfter = await countRuns();
  const merged = outcomes.filter((o) => o.deleted).length;

  console.log('-'.repeat(100));
  console.log(`merged:      ${merged}`);
  console.log(`skipped:     ${outcomes.length - merged}`);
  console.log(`runs after:  ${runsBefore} -> ${runsAfter}`);

  const orphans = await orphanFeedbackCount();
  console.log(`orphaned run_feedback rows: ${orphans} (1 is pre-existing; growth means something cascaded)`);
}

/**
 * run_feedback rows whose run_id no longer resolves. One is a known pre-existing
 * orphan; any increase is the signature of a cascade that should not have happened.
 */
async function orphanFeedbackCount(): Promise<number> {
  const { data: feedback, error } = await supabase.from('run_feedback').select('run_id');
  if (error) throw new Error(`Failed to read run_feedback: ${error.message}`);

  const runIds = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error: runErr } = await supabase.from('runs').select('id').range(from, from + pageSize - 1);
    if (runErr) throw new Error(`Failed to read runs: ${runErr.message}`);
    const page = (data ?? []) as { id: string }[];
    page.forEach((r) => runIds.add(r.id));
    if (page.length < pageSize) break;
  }

  return ((feedback ?? []) as { run_id: string | null }[]).filter((f) => !f.run_id || !runIds.has(f.run_id)).length;
}

main().catch((err) => {
  console.error('\nmerge-duplicate-runs failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
