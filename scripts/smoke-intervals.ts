/**
 * Read-only smoke test for the intervals.icu chain.
 *
 * Proves client -> auth -> fetch -> toNormalizedRun end to end without touching
 * the database and without needing a row in `intervals_tokens`. That matters
 * before the connect UI exists: the sync route reads credentials from that
 * table, so it cannot run until the page that populates it is built. This
 * reads from the environment instead.
 *
 * Makes NO writes — neither to intervals.icu nor to Postgres.
 *
 * Usage:
 *   bunx tsx scripts/smoke-intervals.ts --env "C:/Users/ido/running-coach/.env.local"
 *   bunx tsx scripts/smoke-intervals.ts --days 7
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

dotenv.config({ path: path.resolve(process.cwd(), argValue('--env') ?? '.env.local') });

// Imported after dotenv so the env-reading factory sees the credentials.
async function main() {
  const { intervalsClientFromEnv } = await import('../lib/intervals/client');
  const { filterRuns, toNormalizedRun, toNormalizedLaps } = await import('../lib/ingest/intervals');
  const { userDateStr, userDateStrDaysAgo } = await import('../lib/utils/user-time');

  const days = Number(argValue('--days') ?? 7);
  const oldest = userDateStrDaysAgo(days);
  const newest = userDateStr();

  console.log(`\nintervals.icu smoke test — READ ONLY, no writes`);
  console.log(`window: ${oldest} .. ${newest} (${days} days)\n`);

  const client = intervalsClientFromEnv();

  const activities = await client.getActivities(oldest, newest);
  const runs = filterRuns(activities);
  console.log(`activities returned: ${activities.length}`);
  console.log(`of which runs:       ${runs.length}`);
  if (activities.length !== runs.length) {
    const skipped = activities.filter((a) => !runs.includes(a)).map((a) => a.type);
    console.log(`filtered out:        ${skipped.join(', ')}`);
  }
  console.log('');

  let offsetProblems = 0;

  for (const activity of runs) {
    const run = toNormalizedRun(activity, client);

    // Resolve the thunks explicitly — in production upsertRun decides whether
    // these are needed at all.
    const laps = toNormalizedLaps(await client.getActivityIntervals(activity.id));
    const stream = await client.getHrStream(activity.id);

    const shiftHours =
      (Date.parse(`${activity.start_date_local.replace(/(Z|[+-]\d{2}:?\d{2})$/, '')}Z`) -
        Date.parse(run.date)) /
      3_600_000;

    console.log(`${run.externalId}`);
    console.log(`  name          ${activity.name}  [${activity.type}]`);
    console.log(`  local -> utc  ${activity.start_date_local} -> ${run.date}   (${shiftHours >= 0 ? '-' : '+'}${Math.abs(shiftHours)}h)`);
    console.log(`  distanceKm    ${run.distanceKm}`);
    console.log(`  durationMin   ${run.durationMin.toFixed(2)}`);
    console.log(`  avg/max HR    ${run.avgHr ?? '-'} / ${run.maxHr ?? '-'}`);
    console.log(`  laps          ${laps.length}`);
    console.log(`  HR points     ${stream?.hr.length ?? 0}`);
    console.log('');

    // Israel is UTC+2 or +3; anything else means the offset is being assumed
    // rather than measured at the instant.
    if (shiftHours !== 2 && shiftHours !== 3) {
      console.log(`  !! unexpected offset ${shiftHours}h — expected 2 (winter) or 3 (summer)\n`);
      offsetProblems++;
    }
  }

  // Wellness is a single call regardless of range.
  const wellness = await client.getWellness(userDateStrDaysAgo(30), newest);
  const withHrv = wellness.filter((w) => typeof w.hrv === 'number').length;
  const latest = wellness[wellness.length - 1];
  console.log(`wellness days returned (30d): ${wellness.length}, with hrv: ${withHrv}`);
  if (latest) {
    const form = typeof latest.ctl === 'number' && typeof latest.atl === 'number'
      ? (latest.ctl - latest.atl).toFixed(1)
      : '-';
    console.log(`latest (${latest.id}): Fitness ${latest.ctl ?? '-'} · Fatigue ${latest.atl ?? '-'} · Form ${form}`);
  }

  console.log(offsetProblems === 0 ? '\nSMOKE TEST PASSED' : `\n${offsetProblems} OFFSET PROBLEM(S)`);
  process.exit(offsetProblems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nsmoke test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
