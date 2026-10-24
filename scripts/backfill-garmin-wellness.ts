/**
 * One-off history import into `runcoach.garmin_daily_wellness`.
 *
 * Goes through production code (`syncGarminWellnessForUser`) in 28-day windows
 * — the body battery endpoint's measured limit — oldest first. Sleep costs one
 * call per night, so a year is ~365 sleep calls plus ~40 range calls.
 *
 * DRY RUN BY DEFAULT: prints the windows it would fetch. `--commit` writes.
 * Stops at the first 429 and prints the `--from` to resume with; the sync has
 * already stored a cooldown, so the cron backs off too.
 *
 * Needs the app's env (.env.local): Supabase service role + INTERVALS_TOKEN_KEY,
 * and a connected Garmin key (connect it in the app first).
 *
 * Usage:
 *   bunx tsx scripts/backfill-garmin-wellness.ts --user <user_id> --from 2025-10-01
 *   bunx tsx scripts/backfill-garmin-wellness.ts --user <user_id> --from 2025-10-01 --commit
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

async function main() {
  const { syncGarminWellnessForUser, dayList, chunkRange } = await import('../lib/garmin/sync');
  const { supabase } = await import('../lib/db/supabase');
  const { userDateStr } = await import('../lib/utils/user-time');

  const userId = argValue('--user');
  const from = argValue('--from');
  const to = argValue('--to') ?? userDateStr();
  const commit = argv.includes('--commit');
  if (!userId || !from) throw new Error('Usage: --user <user_id> --from YYYY-MM-DD [--to YYYY-MM-DD] [--commit]');

  const windows = chunkRange(dayList(from, to), 28);
  console.log(`\nGarmin wellness backfill — ${commit ? 'COMMIT' : 'DRY RUN'} — ${from} .. ${to}, ${windows.length} windows`);

  if (!commit) {
    for (const [a, b] of windows) console.log(`  would fetch ${a} .. ${b}`);
    console.log('\nRe-run with --commit to write.');
    return;
  }

  let total = 0;
  for (const [a, b] of windows) {
    const r = await syncGarminWellnessForUser(userId, { from: a, to: b, sleepSpacingMs: 300 });
    if (r.skipped) {
      console.log(`  ${a} .. ${b}: skipped (${r.skipped})${r.skipped === 'cooldown' ? ` — resume with --from ${a}` : ''}`);
      return;
    }
    const ok = Object.entries(r.components).filter(([, v]) => v).map(([k]) => k).join(', ');
    console.log(`  ${a} .. ${b}: ${r.daysUpserted} days [${ok}]${r.errors.length ? ` errors: ${r.errors.join(' | ')}` : ''}`);
    total += r.daysUpserted;
    if (r.errors.some((e) => e.includes('429'))) {
      console.log(`\nRate limited. Resume with --from ${a} after the cooldown.`);
      return;
    }
  }

  // Acceptance: per-field coverage over what is now stored.
  const { data } = await supabase
    .from('garmin_daily_wellness')
    .select('day,body_battery_max,body_battery_at_wake,stress_avg,sleep_secs,sleep_deep_secs,hrv_status')
    .eq('user_id', userId)
    .gte('day', from)
    .lte('day', to);
  const rows = data ?? [];
  const count = (k: string) => rows.filter((r) => (r as Record<string, unknown>)[k] != null).length;
  console.log(`\n${total} day-rows written. Stored coverage over ${rows.length} days:`);
  for (const k of ['body_battery_max', 'body_battery_at_wake', 'stress_avg', 'sleep_secs', 'sleep_deep_secs', 'hrv_status']) {
    console.log(`  ${k.padEnd(22)} ${count(k)}/${rows.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
