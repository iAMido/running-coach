/**
 * Throwaway probe: does intervals.icu resolve "% HR" against THRESHOLD or MAX?
 *
 * Everything in Phase 9 depends on the answer, and it is currently an
 * inference. The two hypotheses give far-apart answers, so one push settles it:
 *
 *   72-83% of threshold 173  ->  125-144 bpm
 *   72-83% of max       191  ->  138-159 bpm
 *
 * Pushes ONE workout, reads it back (the GET may return resolved absolute
 * targets, which answers it without opening the calendar), then DELETES it in a
 * finally block so a failure mid-probe still cleans up.
 *
 * Scheduled ~10 days out, deliberately outside the ~7-day upload horizon, so it
 * cannot reach the watch.
 *
 * Requires --commit: this writes to the athlete's real training calendar.
 *
 *   bunx tsx scripts/probe-workout-push.ts --env "C:/.../.env.local" --commit
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
const BASE = 'https://intervals.icu/api/v1';
const PCT_LOW = Number(argValue('--low') ?? 72);
const PCT_HIGH = Number(argValue('--high') ?? 83);

async function main() {
  const apiKey = process.env.INTERVALS_API_KEY;
  const athleteId = process.env.INTERVALS_ATHLETE_ID;
  if (!apiKey || !athleteId) throw new Error('INTERVALS_API_KEY / INTERVALS_ATHLETE_ID not set');

  const auth = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
  const headers = { Authorization: auth, 'User-Agent': 'RunCoach/1.0', 'Content-Type': 'application/json' };

  const { userDateStrDaysAgo } = await import('../lib/utils/user-time');
  // 10 days ahead — outside the ~7-day upload horizon, so it cannot reach the watch.
  const date = userDateStrDaysAgo(-10);

  console.log('\nintervals.icu workout-push probe');
  console.log(`  athlete   ${athleteId}`);
  console.log(`  date      ${date}  (outside the ~7-day upload horizon)`);
  console.log(`  testing   "- 10m ${PCT_LOW}-${PCT_HIGH}% HR"`);
  console.log(`  if THRESHOLD-anchored (173) -> expect ~${Math.round(1.73 * PCT_LOW)}-${Math.round(1.73 * PCT_HIGH)} bpm`);
  console.log(`  if MAX-anchored       (191) -> expect ~${Math.round(1.91 * PCT_LOW)}-${Math.round(1.91 * PCT_HIGH)} bpm\n`);

  if (!COMMIT) {
    console.log('DRY RUN — pass --commit to actually push. Nothing sent.');
    return;
  }

  const payload = {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Run',
    name: 'ZZ TEST — delete me (RunCoach probe)',
    moving_time: 600,
    description: `- 10m ${PCT_LOW}-${PCT_HIGH}% HR`,
  };

  let eventId: string | number | null = null;
  try {
    const postRes = await fetch(`${BASE}/athlete/${athleteId}/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const postBody = await postRes.text();
    console.log(`POST  -> HTTP ${postRes.status}`);
    if (!postRes.ok) {
      console.log(postBody.slice(0, 600));
      return;
    }

    const created = JSON.parse(postBody);
    eventId = created.id ?? null;
    console.log(`  created event id: ${eventId}\n`);

    // Read it back — resolved absolute targets, if returned, answer the question
    // outright.
    const getRes = await fetch(`${BASE}/athlete/${athleteId}/events/${eventId}`, { headers });
    const event = await getRes.json();
    console.log(`GET   -> HTTP ${getRes.status}`);

    // Print anything that looks like a resolved target rather than dumping the
    // whole payload.
    const interesting = Object.entries(event).filter(([k, v]) =>
      /hr|zone|target|intensity|workout_doc|steps/i.test(k) && v !== null && v !== undefined,
    );
    for (const [k, v] of interesting) {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      console.log(`  ${k} = ${s.length > 500 ? s.slice(0, 500) + '…' : s}`);
    }
    if (interesting.length === 0) {
      console.log('  (no resolved-target fields returned — check the calendar UI for this date)');
      console.log(`  https://intervals.icu/calendar`);
    }
  } finally {
    if (eventId !== null) {
      const del = await fetch(`${BASE}/athlete/${athleteId}/events/${eventId}`, { method: 'DELETE', headers });
      console.log(`\nDELETE -> HTTP ${del.status}${del.ok ? ' (cleaned up)' : ' — REMOVE IT MANUALLY'}`);
    }
  }
}

main().catch((err) => {
  console.error('\nprobe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
