/**
 * Provider-agnostic run ingestion.
 *
 * The per-activity mapping — zone bucketing, classification, TRIMP, pace, laps,
 * the morning-after coach note — used to live twice, once in
 * `app/api/strava/sync/route.ts` and once in `app/api/cron/strava-sync/route.ts`.
 * intervals.icu would have made it three copies. This is the single owner.
 *
 * A provider's only job is to produce a `NormalizedRun`; everything downstream
 * of that is identical no matter where the activity came from.
 *
 * ## Matching
 *
 * The rule that keeps a backfill from duplicating runs already in the table:
 *
 *   1. exact `filename = externalId`  -> update that row
 *   2. else same user, |Δdate| <= 4h and |Δdistance| <= max(50 m, 2%)  -> update that row
 *   3. else insert
 *
 * Rule 2 exists because intervals.icu and Strava assign unrelated ids to the
 * same run, so `filename` alone would insert a second copy of all ~98 runs the
 * database already holds — and orphan the `run_feedback` rows hanging off the
 * originals.
 *
 * Updates are always **fill-null-only** and always preserve the row's `id`.
 * `run_feedback.run_id` and `laps.run_id` are both ON DELETE CASCADE, so
 * re-keying or replacing a row silently destroys feedback and laps. A non-null
 * column is never overwritten, which also makes re-ingestion idempotent and
 * means historical `run_type` is never reclassified under newer zone bands.
 *
 * ## Idempotent is not the same as concurrency-safe
 *
 * Look-then-insert is correct for one caller at a time and silently wrong for
 * two: both look up a brand-new activity, both find nothing, both insert. That
 * was unreachable while the only callers were crons six hours apart, and became
 * reachable the moment the app started syncing on open.
 *
 * `runs_user_filename_uniq` (partial unique index on `(user_id, filename)`)
 * makes the duplicate impossible in the storage layer rather than by
 * convention, so callers added later are covered without anyone remembering a
 * rule. Rule 3 below therefore catches 23505 and re-reads the winner's row: a
 * lost race resolves to rule 1, which is what it always meant.
 *
 * This does NOT protect the fuzzy path — two providers inserting the same run
 * under different ids is a different problem, and it is what rule 2 is for.
 */

import { supabase } from '@/lib/db/supabase';
import { classifyRun } from '@/lib/utils/run-classifier';
import { calculateTrimp } from '@/lib/utils/trimp';
import { formatPace, calculatePace } from '@/lib/utils/pace';
import { computeZonePercentsFromStream, type ZoneBands } from '@/lib/utils/zones';
import { computeDecoupling } from '@/lib/utils/decoupling';
import { vertPerKm } from '@/lib/utils/elevation';
import { generateRunReaction, plannedWorkoutForRunDate } from '@/lib/ai/run-reaction';
import type { AthleteProfile, TrainingPlan } from '@/lib/db/types';

// ------------------------------------------------------------------ types

/** A value, or a function producing it — resolved only if actually needed. */
export type Lazy<T> = T | (() => T | Promise<T>);

export interface NormalizedLap {
  lapNumber: number;
  distanceKm?: number;
  durationSec?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgPaceStr?: string | null;
  /** Grade-adjusted pace, min/km — same unit as avgPaceStr's source. */
  gapPaceMinKm?: number | null;
  /** STEPS per minute, already doubled from the provider's one-leg rpm. */
  cadenceSpm?: number | null;
  /**
   * Metres climbed in this lap. Whole metres, positive.
   *
   * Says which SEGMENT of a session did the climbing. Deliberately never summed
   * into the run total — provider laps are detected segments that do not cover
   * the whole activity.
   */
  elevationGainM?: number | null;
}

export interface HrStream {
  hr: number[];
  /** Seconds elapsed, parallel to `hr`. Null means assume 1 Hz sampling. */
  time: number[] | null;
}

export type DataSource = 'strava_sync' | 'intervals_sync' | 'fit_upload' | 'garmin';

export interface NormalizedRun {
  /** Stored as `filename`, e.g. "strava_1234" or "icu_i172834288". */
  externalId: string;
  /** ISO instant, true UTC. Providers reporting local time must convert first. */
  date: string;
  distanceKm: number;
  durationMin: number;
  avgHr?: number | null;
  maxHr?: number | null;
  calories?: number | null;
  workoutName?: string | null;
  dataSource: DataSource;
  /**
   * Grade-adjusted pace, min/km — directly comparable to the computed
   * `avg_pace_min_km` rather than needing a unit conversion first.
   */
  gapPaceMinKm?: number | null;
  /** STEPS per minute, already doubled from the provider's one-leg rpm. */
  cadenceSpm?: number | null;
  /** Metres climbed over the whole run, whole metres, positive. */
  elevationGainM?: number | null;
  /** Metres descended over the whole run, reported POSITIVE — not a negative gain. */
  elevationLossM?: number | null;
  /** Fetched only when zones are actually needed — see `resolveZones`. */
  hrStream?: Lazy<HrStream | null> | null;
  /** Fetched only when the target row has no laps. */
  laps?: Lazy<NormalizedLap[] | null> | null;
}

export interface UpsertContext {
  profile: AthleteProfile | null;
  zoneBands: ZoneBands;
  /**
   * Used for the morning-after coach note. Pass a thunk (see `once`) to keep
   * the plan unfetched until a run is actually imported.
   */
  activePlan?: Lazy<TrainingPlan | null> | null;
  /** Set false to skip the coach note (backfills, where it is noise). */
  generateCoachNote?: boolean;
  /**
   * Whether this provider's `date` and `externalId` outrank whatever is already
   * stored, **on a fuzzy match only**. See `reconcileIdentity` below.
   *
   * Set this for intervals.icu (timestamps come from the Garmin FIT file).
   * Leave it off for Strava, so the two providers cannot fight over the same
   * row's identity on alternating syncs.
   */
  identityIsAuthoritative?: boolean;
}

/** How an existing row was recognised as this run. */
export type MatchKind = 'filename' | 'fuzzy';

export interface UpsertResult {
  runId: string;
  created: boolean;
  lapsWritten: number;
  /** True when an existing row was found and at least one column written. */
  enriched: boolean;
  /** Null on insert; how the existing row was found otherwise. */
  matchedBy: MatchKind | null;
  /** True when a wrong stored timestamp was corrected. */
  dateCorrected: boolean;
}

type ZonePercents = ReturnType<typeof computeZonePercentsFromStream>;

/** The columns this module reads when deciding what an existing row is missing. */
export interface ExistingRunRow {
  id: string;
  filename: string | null;
  date: string;
  distance_km: number | null;
  duration_min: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_min_km: number | null;
  avg_pace_str: string | null;
  gap_pace_min_km: number | null;
  cadence_spm: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  decoupling_pct: number | null;
  calories: number | null;
  run_type: string | null;
  workout_name: string | null;
  coach_notes: string | null;
  trimp: number | null;
  data_source: string | null;
  pct_z1: number | null;
  pct_z2: number | null;
  pct_z3: number | null;
  pct_z4: number | null;
  pct_z5: number | null;
  pct_z6: number | null;
}

const EXISTING_COLUMNS =
  'id,filename,date,distance_km,duration_min,avg_hr,max_hr,avg_pace_min_km,avg_pace_str,' +
  // `vert_per_km` is a GENERATED column — Postgres computes it from
  // elevation_gain_m and distance_km, and any attempt to write it errors.
  // It is deliberately absent from both this list and every patch below.
  'gap_pace_min_km,cadence_spm,elevation_gain_m,elevation_loss_m,decoupling_pct,' +
  'calories,run_type,workout_name,coach_notes,trimp,data_source,pct_z1,pct_z2,pct_z3,pct_z4,pct_z5,pct_z6';

// -------------------------------------------------------------- lazy utils

async function resolve<T>(v: Lazy<T> | null | undefined): Promise<T | null> {
  if (v == null) return null;
  if (typeof v === 'function') return (await (v as () => T | Promise<T>)()) ?? null;
  return v;
}

/**
 * Memoize an async thunk so a loop over many activities fetches at most once.
 * Callers use this for the active training plan.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}

// ------------------------------------------------------------------ match

/** Distance tolerance: the larger of 50 m and 2% of the longer of the two. */
const ABS_DISTANCE_TOLERANCE_KM = 0.05;
const REL_DISTANCE_TOLERANCE = 0.02;

/**
 * Must exceed 3h, and that is the whole point.
 *
 * The corruption this window exists to catch is a row storing Israel local time
 * in a timestamptz column. Israel is UTC+3 in summer, so such a row sits exactly
 * 3.0000h from the truth — dead on a `<= 3` boundary, where one second of clock
 * drift between providers flips a correction into a silent duplicate insert. The
 * 11 known bad rows are winter (+2h) and would survive a 3h window by luck, not
 * by design.
 *
 * 4h buys an hour of margin. Verified safe against all 660 runs: widening from
 * 3h admits exactly one new pair (2025-03-22, 2.76km vs 26.27km) which the
 * distance test rejects by 23.5km. Distance +-2% is doing the real
 * discrimination; time only has to be loose enough to span a timezone error.
 *
 * The assumption to revisit if training changes: no two runs of near-identical
 * distance start within 4h of each other. True across the whole history — there
 * are no same-distance doubles.
 */
const MATCH_WINDOW_HOURS = 4;

function distancesMatch(a: number, b: number): boolean {
  const tolerance = Math.max(ABS_DISTANCE_TOLERANCE_KM, REL_DISTANCE_TOLERANCE * Math.max(a, b));
  return Math.abs(a - b) <= tolerance;
}

/**
 * `new Date` here is absolute-instant arithmetic (window bounds around a
 * timestamp), not calendar math — it is timezone-independent, so the
 * `lib/utils/user-time.ts` rule does not apply. Day/week questions in this
 * module go through `plannedWorkoutForRunDate`, which handles the timezone.
 */
/**
 * Exported so the backfill's dry run can report what it *would* do using the
 * exact matcher production uses. A separate re-implementation would make the
 * dry run a test of code that never ships.
 */
export async function findExistingRun(
  userId: string,
  run: NormalizedRun,
): Promise<{ row: ExistingRunRow; matchedBy: MatchKind } | null> {
  const exact = await findByFilename(userId, run.externalId);
  if (exact) return { row: exact, matchedBy: 'filename' };

  const centre = new Date(run.date).getTime();
  if (!Number.isFinite(centre)) return null;
  const windowMs = MATCH_WINDOW_HOURS * 3_600_000;

  const { data: nearby } = await supabase
    .from('runs')
    .select(EXISTING_COLUMNS)
    .eq('user_id', userId)
    .gte('date', new Date(centre - windowMs).toISOString())
    .lte('date', new Date(centre + windowMs).toISOString());

  const candidates = ((nearby ?? []) as unknown as ExistingRunRow[]).filter(
    (r) => r.distance_km != null && distancesMatch(r.distance_km, run.distanceKm),
  );
  if (candidates.length === 0) return null;

  // Closest in time wins; distance breaks ties.
  const row = candidates.reduce((best, r) => {
    const d = (x: ExistingRunRow) => Math.abs(new Date(x.date).getTime() - centre);
    if (d(r) !== d(best)) return d(r) < d(best) ? r : best;
    const dist = (x: ExistingRunRow) => Math.abs((x.distance_km ?? 0) - run.distanceKm);
    return dist(r) < dist(best) ? r : best;
  });

  return { row, matchedBy: 'fuzzy' };
}

/** The row for one provider activity id, or null. Unique by construction. */
async function findByFilename(userId: string, externalId: string): Promise<ExistingRunRow | null> {
  const { data } = await supabase
    .from('runs')
    .select(EXISTING_COLUMNS)
    .eq('user_id', userId)
    .eq('filename', externalId)
    .maybeSingle();
  return (data as unknown as ExistingRunRow) ?? null;
}

// ------------------------------------------------------------------ zones

async function resolveZones(run: NormalizedRun, zoneBands: ZoneBands): Promise<ZonePercents | null> {
  if (!run.avgHr) return null;
  try {
    const stream = await resolve(run.hrStream);
    if (!stream || !Array.isArray(stream.hr) || stream.hr.length === 0) return null;
    return computeZonePercentsFromStream(stream.hr, stream.time, zoneBands);
  } catch {
    // Zone data is an enrichment; a provider outage must not fail the import.
    return null;
  }
}

function zonesForClassifier(z: ZonePercents | null) {
  return z
    ? { z1: z.pct_z1, z2: z.pct_z2, z3: z.pct_z3, z4: z.pct_z4, z5: z.pct_z5, z6: z.pct_z6 }
    : undefined;
}

// ------------------------------------------------------------------- laps

async function countLaps(runId: string): Promise<number> {
  const { count } = await supabase.from('laps').select('*', { count: 'exact', head: true }).eq('run_id', runId);
  return count ?? 0;
}

/** Insert laps for a run. Returns how many rows landed; best-effort throughout. */
/**
 * Compute and store aerobic decoupling from the laps now present on the row.
 *
 * Runs after laps are written, and reads them back from the database rather
 * than from the incoming payload, so the insert path and the enrich path (where
 * laps may already have existed) produce the number the same way.
 *
 * Fill-null-only and best-effort: decoupling is derived, so failing to compute
 * it must never cost the import.
 */
async function applyDecoupling(
  runId: string,
  runType: string | null,
  /** The run's gradient — raises the pace ceiling for a climbing session. */
  vertPerKm: number | null,
): Promise<void> {
  try {
    const { data } = await supabase
      .from('laps')
      .select('duration_sec,avg_hr,gap_pace_min_km')
      .eq('run_id', runId)
      .order('lap_number', { ascending: true });

    const laps = (data ?? []) as { duration_sec: number | null; avg_hr: number | null; gap_pace_min_km: number | null }[];
    if (laps.length === 0) return;

    const result = computeDecoupling(
      laps.map((l) => ({ durationSec: l.duration_sec, avgHr: l.avg_hr, gapPaceMinKm: l.gap_pace_min_km })),
      runType,
      vertPerKm,
    );
    if (result.decouplingPct === null) return;

    await supabase
      .from('runs')
      .update({ decoupling_pct: result.decouplingPct, decoupling_method: result.method })
      .eq('id', runId);
  } catch {
    // Derived metric — never fail an import over it.
  }
}

async function writeLaps(runId: string, run: NormalizedRun): Promise<number> {
  try {
    const laps = await resolve(run.laps);
    if (!laps || laps.length === 0) return 0;

    const rows = laps.map((lap) => ({
      run_id: runId,
      lap_number: lap.lapNumber,
      distance_km: lap.distanceKm != null ? Math.round(lap.distanceKm * 1000) / 1000 : null,
      duration_sec: lap.durationSec != null ? Math.round(lap.durationSec) : null,
      avg_hr: lap.avgHr != null ? Math.round(lap.avgHr) : null,
      max_hr: lap.maxHr != null ? Math.round(lap.maxHr) : null,
      avg_pace_str: lap.avgPaceStr ?? null,
      gap_pace_min_km: lap.gapPaceMinKm ?? null,
      cadence_spm: lap.cadenceSpm ?? null,
      elevation_gain_m: lap.elevationGainM ?? null,
    }));

    const { error } = await supabase.from('laps').insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------- coach note

async function attachCoachNote(
  runId: string,
  run: NormalizedRun,
  runType: string,
  zones: ZonePercents | null,
  avgPaceMinKm: number,
  ctx: UpsertContext,
): Promise<void> {
  try {
    const plan = await resolve(ctx.activePlan);
    const { workout, phase } = plannedWorkoutForRunDate(plan, run.date);
    const note = await generateRunReaction({
      distanceKm: run.distanceKm,
      durationMin: run.durationMin,
      avgPaceStr: formatPace(avgPaceMinKm),
      avgHr: run.avgHr ?? null,
      runType,
      zonePercents: zonesForClassifier(zones) ?? null,
      plannedWorkout: workout,
      planPhase: phase,
    });
    if (note) {
      await supabase.from('runs').update({ coach_notes: note }).eq('id', runId);
    }
  } catch {
    // The note is a bonus, never a blocker.
  }
}

// ----------------------------------------------------------------- upsert

/**
 * Insert a run, or enrich the row that already represents it.
 *
 * Never deletes, never re-keys, never overwrites a populated column.
 */
export async function upsertRun(
  userId: string,
  run: NormalizedRun,
  ctx: UpsertContext,
): Promise<UpsertResult> {
  const existing = await findExistingRun(userId, run);
  if (existing) return enrichExisting(existing.row, existing.matchedBy, run, ctx);

  try {
    return await insertNew(userId, run, ctx);
  } catch (err) {
    if (!(err instanceof RunAlreadyImportedError)) throw err;

    // Lost a race: another sync inserted this exact activity between our
    // lookup and our insert. That is not an error — it is the answer to the
    // question we were asking. Re-read the winner's row and carry on as a
    // filename match, so the result is identical to having lost the race by a
    // second longer.
    const row = await findByFilename(userId, run.externalId);
    if (!row) throw err; // constraint fired but the row is gone: genuinely wrong
    return enrichExisting(row, 'filename', run, ctx);
  }
}

/**
 * `runs_user_filename_uniq` rejected the insert, so this activity is already
 * stored. See supabase/migrations/20260807_runs_user_filename_uniq.sql.
 */
class RunAlreadyImportedError extends Error {}

/** Postgres unique_violation, surfaced by PostgREST on the error body. */
const UNIQUE_VIOLATION = '23505';

async function insertNew(userId: string, run: NormalizedRun, ctx: UpsertContext): Promise<UpsertResult> {
  const avgHr = run.avgHr != null ? Math.round(run.avgHr) : null;
  const maxHr = run.maxHr != null ? Math.round(run.maxHr) : null;
  const avgPaceMinKm = calculatePace(run.distanceKm, run.durationMin);

  const zones = await resolveZones(run, ctx.zoneBands);

  const runType = classifyRun({
    distanceKm: run.distanceKm,
    avgHr: avgHr ?? undefined,
    maxHr: maxHr ?? undefined,
    durationMin: run.durationMin,
    workoutName: run.workoutName,
    profile: ctx.profile,
    zonePercents: zonesForClassifier(zones),
    elevationGainM: run.elevationGainM ?? null,
  });

  const trimp = avgHr ? calculateTrimp({ durationMin: run.durationMin, avgHr }) : null;

  const { data: inserted, error } = await supabase
    .from('runs')
    .insert({
      user_id: userId,
      filename: run.externalId,
      date: run.date,
      distance_km: Math.round(run.distanceKm * 100) / 100,
      duration_min: Math.round(run.durationMin * 100) / 100,
      avg_hr: avgHr,
      max_hr: maxHr,
      avg_pace_min_km: avgPaceMinKm,
      avg_pace_str: formatPace(avgPaceMinKm),
      gap_pace_min_km: run.gapPaceMinKm ?? null,
      cadence_spm: run.cadenceSpm ?? null,
      elevation_gain_m: run.elevationGainM ?? null,
      elevation_loss_m: run.elevationLossM ?? null,
      calories: run.calories || null,
      run_type: runType,
      workout_name: run.workoutName ?? null,
      trimp,
      data_source: run.dataSource,
      ...(zones || {}),
    })
    .select('id')
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new RunAlreadyImportedError(`Run ${run.externalId} was inserted by a concurrent sync.`);
  }
  if (error || !inserted) {
    throw new Error(`Failed to insert run ${run.externalId}: ${error?.message ?? 'no row returned'}`);
  }

  const runId = (inserted as { id: string }).id;
  const lapsWritten = await writeLaps(runId, run);
  await applyDecoupling(runId, runType, vertPerKm(run.elevationGainM, run.distanceKm));

  if (ctx.generateCoachNote !== false) {
    await attachCoachNote(runId, run, runType, zones, avgPaceMinKm, ctx);
  }

  return { runId, created: true, lapsWritten, enriched: false, matchedBy: null, dateCorrected: false };
}

/**
 * Decide what to write onto an existing row. Pure, so the rules below are
 * testable without a database.
 *
 * Default is fill-null-only: a populated column is never overwritten, which
 * makes re-ingestion idempotent and stops historical `run_type` being restated
 * under newer zone bands.
 *
 * ## The identity exception
 *
 * A *fuzzy* match is positive evidence that the stored row disagrees with the
 * incoming one — that is what made it fuzzy rather than exact. For a provider
 * whose timestamps are authoritative, two columns therefore get overwritten:
 *
 * - `date`, because ~50 `strava_sync` rows hold Israel local time in a
 *   timestamptz column. Fill-null-only can never repair that: `date` is never
 *   null, so the wrong value would survive forever. Stored is 2-3h late, so a
 *   22:30 run reads as 01:30 the next day once `user-time.ts` resolves it into
 *   a training day — wrong day, wrong week bucket, wrong weekly volume.
 * - `filename`, because otherwise the row keeps its `strava_...` id, never
 *   converges to the `icu_...` one, and is re-fuzzy-matched on every future
 *   sync forever.
 *
 * Gated on `identityIsAuthoritative` so only intervals.icu does this. If Strava
 * did it too, the two providers would rewrite each other's identity on
 * alternating syncs and never converge.
 */
export function buildEnrichPatch(
  existing: ExistingRunRow,
  run: NormalizedRun,
  opts: {
    matchedBy: MatchKind;
    identityIsAuthoritative?: boolean;
    zones: ZonePercents | null;
    profile: AthleteProfile | null;
  },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const fill = (column: keyof ExistingRunRow, value: unknown) => {
    if (existing[column] == null && value != null) patch[column] = value;
  };

  fill('filename', run.externalId);
  fill('avg_hr', run.avgHr != null ? Math.round(run.avgHr) : null);
  fill('max_hr', run.maxHr != null ? Math.round(run.maxHr) : null);
  fill('calories', run.calories || null);
  fill('workout_name', run.workoutName ?? null);
  fill('data_source', run.dataSource);
  fill('gap_pace_min_km', run.gapPaceMinKm ?? null);
  fill('cadence_spm', run.cadenceSpm ?? null);
  fill('elevation_gain_m', run.elevationGainM ?? null);
  fill('elevation_loss_m', run.elevationLossM ?? null);

  if (existing.avg_pace_min_km == null || existing.avg_pace_str == null) {
    const pace = calculatePace(run.distanceKm, run.durationMin);
    fill('avg_pace_min_km', pace);
    fill('avg_pace_str', formatPace(pace));
  }

  const effectiveAvgHr = existing.avg_hr ?? (run.avgHr != null ? Math.round(run.avgHr) : null);
  if (existing.trimp == null && effectiveAvgHr) {
    fill('trimp', calculateTrimp({ durationMin: existing.duration_min ?? run.durationMin, avgHr: effectiveAvgHr }));
  }

  if (opts.zones) Object.assign(patch, opts.zones);

  // Classify only if the row was never classified.
  if (existing.run_type == null) {
    patch.run_type = classifyRun({
      distanceKm: existing.distance_km ?? run.distanceKm,
      avgHr: effectiveAvgHr ?? undefined,
      maxHr: (existing.max_hr ?? run.maxHr) ?? undefined,
      durationMin: existing.duration_min ?? run.durationMin,
      workoutName: existing.workout_name ?? run.workoutName,
      profile: opts.profile,
      zonePercents: zonesForClassifier(opts.zones),
      elevationGainM: existing.elevation_gain_m ?? run.elevationGainM ?? null,
    });
  }

  if (opts.matchedBy === 'fuzzy' && opts.identityIsAuthoritative) {
    const storedMs = new Date(existing.date).getTime();
    const incomingMs = new Date(run.date).getTime();
    if (Number.isFinite(incomingMs) && storedMs !== incomingMs) {
      patch.date = run.date;
    }
    if (existing.filename !== run.externalId) {
      patch.filename = run.externalId;
    }
  }

  return patch;
}

async function enrichExisting(
  existing: ExistingRunRow,
  matchedBy: MatchKind,
  run: NormalizedRun,
  ctx: UpsertContext,
): Promise<UpsertResult> {
  // Only pay for the HR stream when the row is actually missing its zones.
  // A complete row costs zero extra provider calls.
  const zones = existing.pct_z1 == null ? await resolveZones(run, ctx.zoneBands) : null;

  const patch = buildEnrichPatch(existing, run, {
    matchedBy,
    identityIsAuthoritative: ctx.identityIsAuthoritative,
    zones,
    profile: ctx.profile,
  });

  if (Object.keys(patch).length > 0) {
    await supabase.from('runs').update(patch).eq('id', existing.id);
  }

  // Backfill laps only when the row has none — never duplicate an existing set.
  let lapsWritten = 0;
  if ((await countLaps(existing.id)) === 0) {
    lapsWritten = await writeLaps(existing.id, run);
  }

  if (existing.decoupling_pct == null) {
    await applyDecoupling(
      existing.id,
      (patch.run_type as string) ?? existing.run_type,
      vertPerKm(existing.elevation_gain_m ?? run.elevationGainM, existing.distance_km ?? run.distanceKm),
    );
  }

  return {
    runId: existing.id,
    created: false,
    lapsWritten,
    enriched: Object.keys(patch).length > 0,
    matchedBy,
    dateCorrected: patch.date != null,
  };
}
