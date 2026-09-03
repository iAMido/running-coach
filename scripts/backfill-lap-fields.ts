/**
 * One-shot: add gap_pace_min_km, cadence_spm and elevation_gain_m to lap rows
 * that already exist.
 *
 * Why this is separate from `backfill-intervals.ts`: `upsertRun` gates lap
 * writing on `countLaps(existing.id) === 0`. That gate is correct — it is what
 * stops a re-sync inserting a duplicate lap set — but it means every lap row
 * that already exists is invisible to the normal backfill. Relaxing the gate to
 * "insert if none, else update" would blur the duplicate protection, so the
 * one-shot lives here and the ingest path stays unambiguous.
 *
 * ## The alignment guard
 *
 * Writing by `lap_number` is only safe if lap N describes the same stretch of
 * road in both systems. Two segmentations exist in this table — Strava-era rows
 * and rows Phase 7 wrote from `icu_intervals` — and they *look* like they could
 * be independent (per-kilometre splits versus detected work/recovery blocks).
 *
 * They are not independent: both derive from the same Garmin FIT lap records,
 * one source read by two consumers. Measured, every run whose counts agree also
 * agrees on per-lap distance to within 5-8 metres. Divergence appears only when
 * intervals.icu's auto-detection merges or adds a segment, which changes the
 * count.
 *
 * So an equal-length check is a working proxy — but it is a proxy. This verifies
 * the property directly instead: every lap must match on `distance_km` within
 * `MAX_LAP_DISTANCE_DRIFT_KM`. Same outcome today, and it keeps holding if the
 * upstream segmentation logic ever changes in a way that preserves counts.
 *
 * UPDATES ONLY. Never inserts, never deletes, never touches run_id or
 * lap_number. Fill-null-only, so re-running is a no-op.
 *
 * DRY RUN BY DEFAULT.
 *
 * Usage:
 *   bunx tsx scripts/backfill-lap-fields.ts --env "C:/Users/ido/running-coach/.env.local"
 *   bunx tsx scripts/backfill-lap-fields.ts --commit
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

const argv = process.argv.slice(2);
const hasFlag = (f: string) => argv.includes(f);
function argValue(flag: string): string | undefined {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

dotenv.config({ path: path.resolve(process.cwd(), argValue('--env') ?? '.env.local') });

const COMMIT = hasFlag('--commit');

/**
 * Per-lap distance agreement required before writing by index.
 *
 * Observed drift on genuinely-aligned runs is 5-8 metres — rounding between two
 * consumers of the same FIT records. A real misalignment would be hundreds of
 * metres, so 50m separates the two cleanly without being brittle.
 */
const MAX_LAP_DISTANCE_DRIFT_KM = 0.05;

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { intervalsClientFromEnv } = await import('../lib/intervals/client');
  const { toNormalizedLaps } = await import('../lib/ingest/intervals');

  console.log(`\nlap field backfill — ${COMMIT ? 'COMMIT (writes)' : 'DRY RUN (no writes)'}\n`);

  // Only rows intervals.icu actually covers. `filename LIKE 'icu\_%'` is the
  // reliable indicator — data_source is not, since enriched rows kept their
  // original provenance.
  const { data: runs, error } = await supabase
    .from('runs')
    .select('id,filename,date,distance_km,workout_name')
    .like('filename', 'icu\\_%')
    .order('date', { ascending: true });

  if (error) throw new Error(`Could not read runs: ${error.message}`);
  const targets = (runs ?? []) as { id: string; filename: string; date: string; distance_km: number; workout_name: string | null }[];
  console.log(`runs with an icu_ id: ${targets.length}`);

  const client = intervalsClientFromEnv();

  let lapsUpdated = 0;
  let runsTouched = 0;
  let runsNoLapsStored = 0;
  let runsAlreadyDone = 0;
  let worstDriftAccepted = 0;
  const countMismatches: string[] = [];
  const driftRejects: string[] = [];
  const errors: string[] = [];

  for (const run of targets) {
    try {
      const { data: lapRows } = await supabase
        .from('laps')
        .select('id,lap_number,distance_km,gap_pace_min_km,cadence_spm,elevation_gain_m')
        .eq('run_id', run.id)
        .order('lap_number', { ascending: true });

      const stored = (lapRows ?? []) as {
        id: string; lap_number: number; distance_km: number | null;
        gap_pace_min_km: number | null; cadence_spm: number | null;
        elevation_gain_m: number | null;
      }[];
      if (stored.length === 0) {
        runsNoLapsStored++;
        continue;
      }

      const needing = stored.filter(
        (l) => l.gap_pace_min_km == null || l.cadence_spm == null || l.elevation_gain_m == null,
      );
      if (needing.length === 0) {
        runsAlreadyDone++;
        continue;
      }

      const activityId = run.filename.replace(/^icu_/, '');
      const incoming = toNormalizedLaps(await client.getActivityIntervals(activityId));

      if (incoming.length !== stored.length) {
        countMismatches.push(
          `${run.date.slice(0, 10)} ${run.workout_name ?? ''} — stored ${stored.length} laps, icu returned ${incoming.length}`,
        );
        continue;
      }

      // Direct alignment check: lap N must describe the same distance in both
      // systems. This is the property index-based writing actually depends on;
      // equal counts merely correlate with it.
      let maxDrift = 0;
      let unverifiable = false;
      for (const lap of stored) {
        const src = incoming[lap.lap_number - 1];
        if (!src || lap.distance_km == null || src.distanceKm == null) {
          unverifiable = true;
          break;
        }
        maxDrift = Math.max(maxDrift, Math.abs(lap.distance_km - src.distanceKm));
      }
      if (unverifiable || maxDrift > MAX_LAP_DISTANCE_DRIFT_KM) {
        driftRejects.push(
          `${run.date.slice(0, 10)} ${run.workout_name ?? ''} — ` +
            (unverifiable ? 'missing distance, cannot verify alignment' : `max lap drift ${(maxDrift * 1000).toFixed(0)}m`),
        );
        continue;
      }
      worstDriftAccepted = Math.max(worstDriftAccepted, maxDrift);

      let touchedThisRun = 0;
      for (const lap of stored) {
        const src = incoming[lap.lap_number - 1];
        if (!src) continue;

        const patch: Record<string, unknown> = {};
        if (lap.gap_pace_min_km == null && src.gapPaceMinKm != null) patch.gap_pace_min_km = src.gapPaceMinKm;
        if (lap.cadence_spm == null && src.cadenceSpm != null) patch.cadence_spm = src.cadenceSpm;
        // Which SEGMENT of the session climbed. Never summed into the run
        // total: provider laps are detected segments that do not tile the
        // activity (measured 130.4 m across laps against 210.9 m on the run).
        if (lap.elevation_gain_m == null && src.elevationGainM != null) {
          patch.elevation_gain_m = src.elevationGainM;
        }
        if (Object.keys(patch).length === 0) continue;

        if (COMMIT) {
          const { error: upErr } = await supabase.from('laps').update(patch).eq('id', lap.id);
          if (upErr) {
            errors.push(`${run.filename} L${lap.lap_number}: ${upErr.message}`);
            continue;
          }
        }
        touchedThisRun++;
      }

      if (touchedThisRun > 0) {
        lapsUpdated += touchedThisRun;
        runsTouched++;
      }
    } catch (err) {
      errors.push(`${run.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nruns whose laps would gain fields : ${runsTouched}`);
  console.log(`lap rows ${COMMIT ? 'updated' : 'that would be updated'} : ${lapsUpdated}`);
  console.log(`runs already complete             : ${runsAlreadyDone}`);
  console.log(`runs with no stored laps          : ${runsNoLapsStored}`);
  console.log(`runs skipped (lap count mismatch) : ${countMismatches.length}`);
  console.log(`runs skipped (lap drift too big)  : ${driftRejects.length}`);
  console.log(`worst per-lap drift accepted      : ${(worstDriftAccepted * 1000).toFixed(0)}m (limit ${MAX_LAP_DISTANCE_DRIFT_KM * 1000}m)`);

  if (driftRejects.length > 0) {
    console.log('\nskipped — lap N does not describe the same distance in both systems:');
    driftRejects.forEach((m) => console.log(`  ${m}`));
  }

  if (countMismatches.length > 0) {
    console.log('\nskipped — stored laps do not correspond 1:1 with intervals.icu splits:');
    countMismatches.forEach((m) => console.log(`  ${m}`));
  }
  if (errors.length > 0) {
    console.log(`\nerrors (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }

  const { count: totalLaps } = await supabase.from('laps').select('*', { count: 'exact', head: true });
  const { count: withGap } = await supabase
    .from('laps')
    .select('*', { count: 'exact', head: true })
    .not('gap_pace_min_km', 'is', null);
  const { count: withElev } = await supabase
    .from('laps')
    .select('*', { count: 'exact', head: true })
    .not('elevation_gain_m', 'is', null);
  console.log(`\nlaps total: ${totalLaps} · with GAP now: ${withGap} · with elevation now: ${withElev}`);
}

main().catch((err) => {
  console.error('\nlap backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
