/**
 * Phase 7 — one-time intervals.icu backfill.
 *
 * Pulls the last ~400 days and runs everything through `upsertRun`, the same
 * function the live sync uses. That is deliberate: this run is the only
 * exercise the enrich/fuzzy-match path gets against real data, so it has to be
 * the real code. A bespoke plan-generator would produce a green result proving
 * nothing about what ships.
 *
 * DRY RUN BY DEFAULT. `--commit` writes, and refuses without a verified backup.
 *
 * Usage:
 *   bunx tsx scripts/backfill-intervals.ts --env "C:/Users/ido/running-coach/.env.local"
 *   bunx tsx scripts/backfill-intervals.ts --commit --snapshot _bak_20260806_runs
 *
 * Flags:
 *   --env <path>        .env file to load (default .env.local)
 *   --days <n>          history window (default 400)
 *   --user <email>      user_id (default: the single athlete_profile row)
 *   --commit            actually write; otherwise report only
 *   --snapshot <table>  backup table name, required with --commit
 *   --no-verify         skip the acceptance-criteria check
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
const DAYS = Number(argValue('--days') ?? 400);
const SNAPSHOT = argValue('--snapshot');
const VERIFY = !hasFlag('--no-verify');

/**
 * Expected outcome, from the probe on 2026-08-05. These are assertions, not
 * documentation — a mismatch means the matcher changed behaviour, which is
 * exactly what a dry run exists to catch.
 */
const EXPECTED = {
  inserts: 19,
  updates: 98,
  dateCorrected: 11,
  runsBefore: 660,
  runsAfter: 679,
  correctionWindow: { from: '2025-12-15', to: '2026-01-11' },
  preExistingOrphans: 1,
};

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { intervalsClientFromEnv } = await import('../lib/intervals/client');
  const { filterRuns, toNormalizedRun } = await import('../lib/ingest/intervals');
  const { findExistingRun, buildEnrichPatch, upsertRun, once } = await import('../lib/ingest/upsert-run');
  const { getAthleteProfile } = await import('../lib/db/profile');
  const { getActivePlan } = await import('../lib/db/plans');
  const { parseZonesFromProfile } = await import('../lib/utils/zones');
  const { userDateStr, userDateStrDaysAgo } = await import('../lib/utils/user-time');

  const userId = argValue('--user') ?? (await defaultUserId(supabase));
  if (!userId) throw new Error('Could not determine user_id — pass --user');

  console.log(`\nintervals.icu backfill — ${COMMIT ? 'COMMIT (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`user: ${userId}`);

  const runsBefore = await countRuns(supabase, userId);
  const orphansBefore = await countOrphanFeedback(supabase);
  console.log(`runs before: ${runsBefore}   orphaned feedback: ${orphansBefore}\n`);

  if (COMMIT) {
    if (!SNAPSHOT) {
      throw new Error(
        'Refusing to --commit without --snapshot <table>. Take a fresh backup first:\n' +
          "  create table runcoach._bak_20260806_runs as select * from runcoach.runs;\n" +
          '(the existing _bak_20260805_* only covers the 38 duplicate-pair rows)',
      );
    }
    const { count, error } = await supabase.from(SNAPSHOT).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`Snapshot table "${SNAPSHOT}" is not readable: ${error.message}`);
    if ((count ?? 0) < 600) {
      throw new Error(`Snapshot "${SNAPSHOT}" holds only ${count} rows — expected the full table (~${runsBefore}).`);
    }
    console.log(`snapshot verified: ${SNAPSHOT} (${count} rows)\n`);
  }

  const client = intervalsClientFromEnv();
  const activities = await client.getActivities(userDateStrDaysAgo(DAYS), userDateStr());
  const runs = filterRuns(activities);
  console.log(`activities in window: ${activities.length}   runs: ${runs.length}\n`);

  const profile = await getAthleteProfile(userId);
  const zoneBands = parseZonesFromProfile(profile);
  const activePlan = once(() => getActivePlan(userId));

  let inserts = 0;
  let updates = 0;
  let exactMatches = 0;
  let lapsBackfilled = 0;
  const corrections: { externalId: string; stored: string; corrected: string }[] = [];
  const errors: string[] = [];

  for (const activity of runs) {
    const run = toNormalizedRun(activity, client);

    try {
      if (COMMIT) {
        const res = await upsertRun(userId, run, {
          profile,
          zoneBands,
          activePlan,
          // A coach note per run across 400 days would be ~117 LLM calls of
          // pure noise about workouts months old.
          generateCoachNote: false,
          identityIsAuthoritative: true,
        });
        if (res.created) inserts++;
        else {
          updates++;
          if (res.matchedBy === 'filename') exactMatches++;
        }
        if (res.lapsWritten > 0) lapsBackfilled++;
        if (res.dateCorrected) {
          corrections.push({ externalId: run.externalId, stored: '(overwritten)', corrected: run.date });
        }
      } else {
        // Same matcher, no writes. Zones are not resolved here — that would
        // double the API calls and cannot affect the insert/update or date
        // decision, only which extra columns get filled.
        const existing = await findExistingRun(userId, run);
        if (!existing) {
          inserts++;
        } else {
          updates++;
          if (existing.matchedBy === 'filename') exactMatches++;
          const patch = buildEnrichPatch(existing.row, run, {
            matchedBy: existing.matchedBy,
            identityIsAuthoritative: true,
            zones: null,
            profile,
          });
          if (patch.date) {
            corrections.push({
              externalId: run.externalId,
              stored: new Date(existing.row.date).toISOString(),
              corrected: String(patch.date),
            });
          }
        }
      }
    } catch (err) {
      errors.push(`${run.externalId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`inserts:        ${inserts}`);
  console.log(`updates:        ${updates}  (of which exact-id matches: ${exactMatches}, fuzzy: ${updates - exactMatches})`);
  if (COMMIT) console.log(`laps written:   ${lapsBackfilled}`);
  console.log(`dateCorrected:  ${corrections.length}`);

  if (corrections.length > 0) {
    console.log('\ntimestamp corrections:');
    for (const c of corrections.sort((a, b) => a.corrected.localeCompare(b.corrected))) {
      console.log(`  ${c.externalId}  ${c.stored} -> ${c.corrected}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nerrors (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }

  // Wellness: one call, 365 days.
  if (COMMIT) {
    const { upsertWellnessDays } = await import('../lib/db/wellness');
    const { toNormalizedWellness } = await import('../lib/ingest/intervals');
    const wellness = await client.getWellness(userDateStrDaysAgo(365), userDateStr());
    const written = await upsertWellnessDays(wellness.map((d) => toNormalizedWellness(userId, d)));
    console.log(`\nwellness days written: ${written}`);
  }

  const runsAfter = await countRuns(supabase, userId);
  const orphansAfter = await countOrphanFeedback(supabase);
  console.log(`\nruns after: ${runsAfter}   orphaned feedback: ${orphansAfter}`);

  if (VERIFY) verifyAcceptanceCriteria({ inserts, updates, corrections, runsBefore, runsAfter, orphansAfter });
}

function verifyAcceptanceCriteria(actual: {
  inserts: number;
  updates: number;
  corrections: { corrected: string }[];
  runsBefore: number;
  runsAfter: number;
  orphansAfter: number;
}) {
  console.log('\n--- acceptance criteria ---');
  const checks: [string, boolean, string][] = [];

  checks.push(['inserts = 19', actual.inserts === EXPECTED.inserts, `got ${actual.inserts}`]);
  checks.push(['updates = 98', actual.updates === EXPECTED.updates, `got ${actual.updates}`]);
  checks.push([
    'dateCorrected = 11',
    actual.corrections.length === EXPECTED.dateCorrected,
    `got ${actual.corrections.length}`,
  ]);

  const outOfWindow = actual.corrections.filter(
    (c) => c.corrected < EXPECTED.correctionWindow.from || c.corrected > `${EXPECTED.correctionWindow.to}T23:59:59Z`,
  );
  checks.push([
    `corrections within ${EXPECTED.correctionWindow.from}..${EXPECTED.correctionWindow.to}`,
    outOfWindow.length === 0,
    outOfWindow.length ? `${outOfWindow.length} outside` : 'all inside',
  ]);

  checks.push([
    `no new feedback orphans (stays ${EXPECTED.preExistingOrphans})`,
    actual.orphansAfter === EXPECTED.preExistingOrphans,
    `got ${actual.orphansAfter}`,
  ]);

  if (COMMIT) {
    checks.push([
      `run count ${EXPECTED.runsBefore} -> ${EXPECTED.runsAfter}`,
      actual.runsAfter === EXPECTED.runsAfter,
      `got ${actual.runsBefore} -> ${actual.runsAfter}`,
    ]);
  } else {
    checks.push([
      'dry run wrote nothing',
      actual.runsAfter === actual.runsBefore,
      `${actual.runsBefore} -> ${actual.runsAfter}`,
    ]);
  }

  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
  }

  console.log(failed === 0 ? '\nALL CRITERIA MET' : `\n${failed} CRITERION/CRITERIA FAILED`);
  if (failed > 0) process.exitCode = 1;
}

async function defaultUserId(supabase: {
  from: (t: string) => {
    select: (c: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: { user_id?: string } | null }> } };
  };
}): Promise<string | undefined> {
  const { data } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  return data?.user_id;
}

async function countRuns(
  supabase: { from: (t: string) => { select: (c: string, o: object) => { eq: (k: string, v: string) => Promise<{ count: number | null }> } } },
  userId: string,
): Promise<number> {
  const { count } = await supabase.from('runs').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return count ?? 0;
}

/**
 * run_feedback rows whose run_id no longer resolves. Must never grow: laps and
 * feedback both cascade on delete, so a rise here means a row was destroyed
 * rather than updated in place.
 */
async function countOrphanFeedback(supabase: {
  from: (t: string) => { select: (c: string) => Promise<{ data: { run_id: string | null }[] | null }> };
}): Promise<number> {
  const { data: feedback } = await supabase.from('run_feedback').select('run_id');
  if (!feedback) return 0;

  const ids = feedback.map((f) => f.run_id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return 0;

  const { data: runs } = await supabase.from('runs').select('id').in('id', ids);
  const alive = new Set((runs ?? []).map((r: { id: string }) => r.id));
  return ids.filter((id) => !alive.has(id)).length;
}

main().catch((err) => {
  console.error('\nbackfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
