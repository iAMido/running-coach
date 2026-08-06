/**
 * One-shot repair of corrupt historical HR zone data.
 *
 * ## What was wrong
 *
 * 204 runs recorded time in Z6 while their maximum heart rate never reached the
 * Z6 floor — time above a threshold never touched, which no band definition can
 * excuse. The old (175) floor was used for that test specifically so the
 * documented 2026-08-05 rescale cannot explain it. In aggregate the legacy rows
 * claim 83.5% of time above Z4 at an average HR of 149, when Z4 begins at 150.
 *
 * Concentrated entirely in the two legacy populations:
 *
 *   garmin      323 runs · 118 impossible · avg Z4+ 83.5% · avg HR 149
 *   garmin+tp   285 runs ·  85 impossible · avg Z4+ 83.3% · avg HR 148
 *   strava_sync  50 runs ·   1 impossible · avg Z4+ 28.0% · avg HR 144
 *   intervals_sync 18 runs ·  0 impossible · avg Z4+  8.3% · avg HR 136
 *
 * The two populations this codebase computed itself are sane and track average
 * HR correctly. The corruption arrived with the imported data.
 *
 * ## What this does
 *
 * Recomputes zones from the actual HR stream for every run intervals.icu covers
 * (`filename LIKE 'icu\_%'`), against the CURRENT bands, using the same
 * `computeZonePercentsFromStream` the live sync uses. That yields one
 * consistent, correct definition across the window the coach actually reasons
 * over, and incidentally removes the 2026-08-05 band discontinuity for those
 * runs.
 *
 * This deliberately OVERWRITES non-null zone columns, which is the one place
 * this repo breaks fill-null-only. That rule exists to protect data that might
 * be right; these values are demonstrably wrong.
 *
 * Runs with no stream source anywhere are handled by `--null-unfixable`:
 * ~560 rows that can never be repaired. Storing a number known to be wrong is
 * worse than storing nothing — absent zones render as absent, wrong zones
 * render as insight.
 *
 * Snapshot: runcoach._bak_20260806_run_zones
 *
 * Usage:
 *   bunx tsx scripts/repair-zones.ts --env "C:/.../.env.local"
 *   bunx tsx scripts/repair-zones.ts --commit
 *   bunx tsx scripts/repair-zones.ts --commit --null-unfixable
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
const NULL_UNFIXABLE = hasFlag('--null-unfixable');
const SNAPSHOT = '_bak_20260806_run_zones';

interface RunRow {
  id: string;
  date: string;
  filename: string;
  data_source: string | null;
  avg_hr: number | null;
  max_hr: number | null;
  pct_z1: number | null;
  pct_z4: number | null;
  pct_z5: number | null;
  pct_z6: number | null;
}

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { intervalsClientFromEnv } = await import('../lib/intervals/client');
  const { getAthleteProfile } = await import('../lib/db/profile');
  const { parseZonesFromProfile, computeZonePercentsFromStream } = await import('../lib/utils/zones');

  console.log(`\nzone repair — ${COMMIT ? 'COMMIT (writes)' : 'DRY RUN (no writes)'}\n`);

  // Refuse without the snapshot: this is the one script that overwrites data
  // which cannot be reconstructed from the provider afterwards.
  const { count: snapCount, error: snapErr } = await supabase
    .from(SNAPSHOT)
    .select('*', { count: 'exact', head: true });
  if (snapErr || (snapCount ?? 0) < 600) {
    throw new Error(`Snapshot ${SNAPSHOT} missing or short (${snapCount ?? 'unreadable'}). Refusing to overwrite zones.`);
  }
  console.log(`snapshot verified: ${SNAPSHOT} (${snapCount} rows)\n`);

  const profile = await getAthleteProfile('idomosseri@gmail.com');
  const bands = parseZonesFromProfile(profile);
  console.log(`bands: Z1<${bands.z1.high} Z2<${bands.z2.high} Z3<${bands.z3.high} Z4<${bands.z4.high} Z5<${bands.z5.high} Z6<=${bands.z6.high}\n`);

  const { data } = await supabase
    .from('runs')
    .select('id,date,filename,data_source,avg_hr,max_hr,pct_z1,pct_z4,pct_z5,pct_z6')
    .like('filename', 'icu\\_%')
    .order('date', { ascending: true });

  const targets = (data ?? []) as RunRow[];
  console.log(`runs intervals.icu covers: ${targets.length}`);

  const client = intervalsClientFromEnv();
  let repaired = 0;
  let noStream = 0;
  let unchanged = 0;
  const bigMoves: string[] = [];
  const errors: string[] = [];

  for (const run of targets) {
    try {
      const stream = await client.getHrStream(run.filename.replace(/^icu_/, ''));
      if (!stream || stream.hr.length === 0) {
        noStream++;
        continue;
      }

      const zones = computeZonePercentsFromStream(stream.hr, stream.time, bands);
      if (!zones) {
        noStream++;
        continue;
      }

      const before = (run.pct_z4 ?? 0) + (run.pct_z5 ?? 0) + (run.pct_z6 ?? 0);
      const after = zones.pct_z4 + zones.pct_z5 + zones.pct_z6;
      const delta = after - before;

      if (Math.abs(delta) < 0.05 && run.pct_z1 !== null) {
        unchanged++;
        continue;
      }

      if (Math.abs(delta) >= 20) {
        bigMoves.push(
          `${run.date.slice(0, 10)} ${String(run.data_source).padEnd(12)} ` +
            `Z4+ ${before.toFixed(1)}% -> ${after.toFixed(1)}%  (avgHR ${run.avg_hr ?? '?'}, maxHR ${run.max_hr ?? '?'})`,
        );
      }

      if (COMMIT) {
        const { error } = await supabase.from('runs').update(zones).eq('id', run.id);
        if (error) {
          errors.push(`${run.filename}: ${error.message}`);
          continue;
        }
      }
      repaired++;
    } catch (err) {
      errors.push(`${run.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nrecomputed from stream : ${repaired}`);
  console.log(`already correct        : ${unchanged}`);
  console.log(`no HR stream available : ${noStream}`);
  if (errors.length) {
    console.log(`errors                 : ${errors.length}`);
    errors.slice(0, 5).forEach((e) => console.log(`  ${e}`));
  }

  if (bigMoves.length) {
    console.log(`\nlargest corrections (Z4+ moved >=20 points) — ${bigMoves.length} runs:`);
    bigMoves.slice(0, 15).forEach((m) => console.log(`  ${m}`));
    if (bigMoves.length > 15) console.log(`  … +${bigMoves.length - 15} more`);
  }

  // Unfixable rows: no stream source exists anywhere, so the wrong numbers can
  // only be removed, never corrected.
  const { count: unfixable } = await supabase
    .from('runs')
    .select('*', { count: 'exact', head: true })
    .not('pct_z1', 'is', null)
    .not('filename', 'like', 'icu\\_%');

  console.log(`\nunfixable rows still holding zones: ${unfixable}`);
  if (NULL_UNFIXABLE) {
    if (COMMIT) {
      const { error } = await supabase
        .from('runs')
        .update({ pct_z1: null, pct_z2: null, pct_z3: null, pct_z4: null, pct_z5: null, pct_z6: null })
        .not('pct_z1', 'is', null)
        .not('filename', 'like', 'icu\\_%');
      if (error) console.log(`  FAILED to null: ${error.message}`);
      else console.log(`  nulled ${unfixable} rows`);
    } else {
      console.log(`  would null ${unfixable} rows (--commit to apply)`);
    }
  } else {
    console.log('  left untouched — pass --null-unfixable to remove them');
  }
}

main().catch((err) => {
  console.error('\nzone repair failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
