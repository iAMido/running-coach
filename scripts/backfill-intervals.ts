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
const RERUN = hasFlag('--rerun');

/**
 * Second-pass expectations, for re-running after new columns are added
 * (Tier 1's gap_pace_min_km / cadence_spm; the 2026-09-03 elevation columns).
 *
 * Enrichment is fill-null-only, so a re-run populates any column added since
 * the last pass with no change to this script beyond the assertions below —
 * that is the whole reason the backfill goes through `upsertRun` rather than
 * owning its own mapping.
 *
 * `dateCorrected: 0` is the important one. The 11 timestamp corrections landed
 * on 2026-08-06; a second pass finding any more means either the identity
 * reconciliation is firing on rows it should not touch, or something rewrote
 * timestamps in between. It is the cheapest available regression check on the
 * enrich path and costs nothing to assert.
 */
const EXPECTED_RERUN = {
  inserts: 0,
  /** Not asserted exactly — it grows with every new run. See verifyAcceptanceCriteria. */
  updates: 0,
  dateCorrected: 0,
  // Deliberately NOT absolute counts. The table grows every day the sync runs,
  // so a hardcoded 680 turns into a false failure the following week and
  // teaches whoever hits it to pass --no-verify. On a re-run the invariant is
  // that the count did not CHANGE — see verifyAcceptanceCriteria.
  runsBefore: 0,
  runsAfter: 0,
  correctionWindow: { from: '2025-12-15', to: '2026-01-11' },
  danglingFeedback: 0,
  unlinkedFeedback: 1,
};

const EXPECTED_FIRST_PASS = {
  inserts: 19,
  updates: 98,
  dateCorrected: 11,
  runsBefore: 660,
  runsAfter: 679,
  correctionWindow: { from: '2025-12-15', to: '2026-01-11' },
  /**
   * Feedback rows pointing at a run id that no longer exists. This is the real
   * safety property — laps and feedback both cascade on delete, so any rise
   * here means a row was destroyed rather than updated in place.
   *
   * Distinct from the one legacy row with `run_id IS NULL`, which was never
   * linked to a run and cannot dangle. An earlier SQL check conflated the two
   * via a LEFT JOIN and reported "1 orphan"; the dangling count is and always
   * has been 0.
   */
  danglingFeedback: 0,
  unlinkedFeedback: 1,
};

const EXPECTED = RERUN ? EXPECTED_RERUN : EXPECTED_FIRST_PASS;

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
  const fbBefore = await countFeedbackIntegrity(supabase);
  console.log(`runs before: ${runsBefore}   dangling feedback: ${fbBefore.dangling}   unlinked: ${fbBefore.unlinked}\n`);

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
  const insertList: { date: string; km: number; name: string }[] = [];
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
          insertList.push({ date: run.date, km: run.distanceKm, name: run.workoutName ?? '' });
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

  if (insertList.length > 0) {
    console.log('\nwould INSERT:');
    for (const i of insertList.sort((a, b) => a.date.localeCompare(b.date))) {
      console.log(`  ${i.date.slice(0, 16).replace('T', ' ')}  ${i.km.toFixed(2).padStart(6)} km  ${i.name}`);
    }
  }

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
  const fbAfter = await countFeedbackIntegrity(supabase);
  console.log(`\nruns after: ${runsAfter}   dangling feedback: ${fbAfter.dangling}   unlinked: ${fbAfter.unlinked}`);

  if (VERIFY) verifyAcceptanceCriteria({ inserts, updates, corrections, runsBefore, runsAfter, fbAfter });
}

function verifyAcceptanceCriteria(actual: {
  inserts: number;
  updates: number;
  corrections: { corrected: string }[];
  runsBefore: number;
  runsAfter: number;
  fbAfter: { dangling: number; unlinked: number };
}) {
  console.log('\n--- acceptance criteria ---');
  const checks: [string, boolean, string][] = [];

  // Labels are derived from EXPECTED rather than hardcoded — a label that
  // disagrees with the assertion it describes is worse than no label.
  checks.push([`inserts = ${EXPECTED.inserts}`, actual.inserts === EXPECTED.inserts, `got ${actual.inserts}`]);
  checks.push([
    `dateCorrected = ${EXPECTED.dateCorrected}`,
    actual.corrections.length === EXPECTED.dateCorrected,
    `got ${actual.corrections.length}`,
  ]);

  if (RERUN) {
    // An exact `updates` count would be brittle — it grows with every new run.
    // The invariant that matters is that nothing was left unmatched, and
    // `inserts === 0` above already asserts exactly that.
    checks.push(['every activity matched an existing row', actual.inserts === 0 && actual.updates > 0, `${actual.updates} updated`]);
  } else {
    checks.push([`updates = ${EXPECTED.updates}`, actual.updates === EXPECTED.updates, `got ${actual.updates}`]);
  }

  const outOfWindow = actual.corrections.filter(
    (c) => c.corrected < EXPECTED.correctionWindow.from || c.corrected > `${EXPECTED.correctionWindow.to}T23:59:59Z`,
  );
  checks.push([
    `corrections within ${EXPECTED.correctionWindow.from}..${EXPECTED.correctionWindow.to}`,
    outOfWindow.length === 0,
    outOfWindow.length ? `${outOfWindow.length} outside` : 'all inside',
  ]);

  checks.push([
    'no feedback row points at a missing run',
    actual.fbAfter.dangling === EXPECTED.danglingFeedback,
    `got ${actual.fbAfter.dangling}`,
  ]);
  checks.push([
    `unlinked feedback unchanged (${EXPECTED.unlinkedFeedback})`,
    actual.fbAfter.unlinked === EXPECTED.unlinkedFeedback,
    `got ${actual.fbAfter.unlinked}`,
  ]);

  if (COMMIT && RERUN) {
    // A re-run enriches in place and must never change the row count, whatever
    // that count happens to be today.
    checks.push([
      'run count unchanged',
      actual.runsAfter === actual.runsBefore,
      `${actual.runsBefore} -> ${actual.runsAfter}`,
    ]);
  } else if (COMMIT) {
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
 * Two distinct integrity numbers, deliberately not conflated:
 *
 * - `dangling`: feedback pointing at a run id that no longer exists. This is
 *   the real safety property. laps and run_feedback both cascade on delete, so
 *   any rise here means a row was destroyed rather than updated in place.
 * - `unlinked`: feedback with run_id IS NULL. One legacy row, never attached to
 *   a run, which cannot dangle. A LEFT JOIN counts it as an orphan and hides
 *   the number that actually matters.
 */
async function countFeedbackIntegrity(supabase: {
  from: (t: string) => {
    select: (c: string) => Promise<{ data: { run_id: string | null }[] | null }>;
  } & { select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: { id: string }[] | null }> } };
}): Promise<{ dangling: number; unlinked: number }> {
  const { data: feedback } = await supabase.from('run_feedback').select('run_id');
  if (!feedback) return { dangling: 0, unlinked: 0 };

  const unlinked = feedback.filter((f) => !f.run_id).length;
  const ids = feedback.map((f) => f.run_id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { dangling: 0, unlinked };

  const { data: runs } = await supabase.from('runs').select('id').in('id', ids);
  const alive = new Set((runs ?? []).map((r: { id: string }) => r.id));
  return { dangling: ids.filter((id) => !alive.has(id)).length, unlinked };
}

main().catch((err) => {
  console.error('\nbackfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
