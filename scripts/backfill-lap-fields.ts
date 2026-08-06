/**
 * One-shot: add gap_pace_min_km + cadence_spm to lap rows that already exist.
 *
 * Why this is separate from `backfill-intervals.ts`: `upsertRun` gates lap
 * writing on `countLaps(existing.id) === 0`. That gate is correct — it is what
 * stops a re-sync inserting a duplicate lap set — but it means every lap row
 * that already exists is invisible to the normal backfill. Relaxing the gate to
 * "insert if none, else update" would blur the duplicate protection, so the
 * one-shot lives here and the ingest path stays unambiguous.
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
  const countMismatches: string[] = [];
  const errors: string[] = [];

  for (const run of targets) {
    try {
      const { data: lapRows } = await supabase
        .from('laps')
        .select('id,lap_number,gap_pace_min_km,cadence_spm')
        .eq('run_id', run.id)
        .order('lap_number', { ascending: true });

      const stored = (lapRows ?? []) as { id: string; lap_number: number; gap_pace_min_km: number | null; cadence_spm: number | null }[];
      if (stored.length === 0) {
        runsNoLapsStored++;
        continue;
      }

      const needing = stored.filter((l) => l.gap_pace_min_km == null || l.cadence_spm == null);
      if (needing.length === 0) {
        runsAlreadyDone++;
        continue;
      }

      const activityId = run.filename.replace(/^icu_/, '');
      const incoming = toNormalizedLaps(await client.getActivityIntervals(activityId));

      // Index-based mapping is only safe when the two sets are the same size.
      // ~50 of these lap sets came from Strava and may not correspond 1:1 with
      // intervals.icu's splits; writing by position there would attach the
      // wrong pace to the wrong rep.
      if (incoming.length !== stored.length) {
        countMismatches.push(
          `${run.date.slice(0, 10)} ${run.workout_name ?? ''} — stored ${stored.length} laps, icu returned ${incoming.length}`,
        );
        continue;
      }

      let touchedThisRun = 0;
      for (const lap of stored) {
        const src = incoming[lap.lap_number - 1];
        if (!src) continue;

        const patch: Record<string, unknown> = {};
        if (lap.gap_pace_min_km == null && src.gapPaceMinKm != null) patch.gap_pace_min_km = src.gapPaceMinKm;
        if (lap.cadence_spm == null && src.cadenceSpm != null) patch.cadence_spm = src.cadenceSpm;
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
  console.log(`\nlaps total: ${totalLaps} · with GAP now: ${withGap}`);
}

main().catch((err) => {
  console.error('\nlap backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
