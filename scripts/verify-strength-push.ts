/**
 * Live check: does intervals.icu read the strength workouts exactly as
 * `strength-format.ts` means them?
 *
 * Renders every distinct strength session in the active plan, posts each as a
 * WeightTraining event 12 days out (beyond the ~7-day watch horizon, so it
 * cannot reach the watch), reads back the parsed `workout_doc`, compares every
 * step's text and duration with what was rendered, and DELETES the events in a
 * finally block.
 *
 * Requires --commit: it writes (briefly) to the athlete's real calendar.
 *
 *   bunx tsx scripts/verify-strength-push.ts --env "C:/Users/ido/running-coach/.env.local" --commit
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
dotenv.config({ path: path.resolve(process.cwd(), argValue('--env') ?? '.env.local') });
const COMMIT = argv.includes('--commit');

interface DocStep { text?: string; duration?: number; reps?: number; steps?: DocStep[]; power?: unknown; hr?: unknown }

/** The parsed doc as (text, seconds) per set, repeats multiplied out. */
function flatten(steps: DocStep[]): { text: string; sec: number; extra: boolean }[] {
  return steps.flatMap((s) =>
    s.reps && s.steps
      ? Array.from({ length: s.reps }, () => flatten(s.steps!)).flat()
      : [{ text: s.text ?? '', sec: s.duration ?? 0, extra: !!(s.power || s.hr) }],
  );
}

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { IntervalsClient } = await import('../lib/intervals/client');
  const { strengthToWorkout, STRENGTH_EVENT_TYPE } = await import('../lib/intervals/strength-format');
  const { userDateStrDaysAgo } = await import('../lib/utils/user-time');
  type PlannedStrength = import('../lib/db/types').PlannedStrength;

  const { data: plan } = await supabase.from('training_plans').select('id, plan_json').eq('status', 'active').limit(1).maybeSingle();
  if (!plan) throw new Error('no active plan');
  const sessions = new Map<string, PlannedStrength>();
  for (const w of (plan.plan_json?.weeks ?? []) as { workouts?: Record<string, { strength?: PlannedStrength }> }[]) {
    for (const wk of Object.values(w.workouts ?? {})) if (wk?.strength?.name) sessions.set(wk.strength.name, wk.strength);
  }
  console.log(`active plan ${plan.id}: ${sessions.size} distinct strength sessions`);

  const date = userDateStrDaysAgo(-12);
  const client = new IntervalsClient({ apiKey: process.env.INTERVALS_API_KEY!, athleteId: process.env.INTERVALS_ATHLETE_ID });
  const raw = client as unknown as { request: <T>(p: string, init?: { method?: string }) => Promise<T> };
  const athlete = process.env.INTERVALS_ATHLETE_ID;

  let failures = 0;
  const created: (number | string)[] = [];
  try {
    for (const st of sessions.values()) {
      const t = strengthToWorkout(st);
      if (!t) { console.log(`  ${st.name}: nothing to push`); continue; }
      console.log(`\n── ${t.name} (${t.minutes} min)\n${t.description}\n${t.notes.map((n) => `   ${n}`).join('\n')}`);
      if (!COMMIT) continue;

      const { id } = await client.createWorkoutEvent({
        startDateLocal: `${date}T00:00:00`, name: `ZZ VERIFY ${t.name}`, type: STRENGTH_EVENT_TYPE,
        description: `${t.description}\n\n${t.notes.join('\n')}\n\nRunCoach:verify`,
        movingTimeSec: t.minutes * 60,
      });
      created.push(id);
      const ev = await raw.request<{ type: string; workout_doc?: { steps?: DocStep[] } }>(`/athlete/${athlete}/events/${id}`);
      const got = flatten(ev.workout_doc?.steps ?? []).filter((s) => s.text !== 'Rest');
      const ok = ev.type === STRENGTH_EVENT_TYPE && got.length === t.cues.length
        && got.every((s, i) => s.text === t.cues[i] && s.sec > 0 && !s.extra);
      if (!ok) {
        failures++;
        console.log(`  MISMATCH (type ${ev.type})`);
        got.forEach((s, i) => { if (s.text !== t.cues[i] || s.extra) console.log(`    got "${s.text}" ${s.sec}s${s.extra ? ' +target' : ''} | want "${t.cues[i]}"`); });
        if (got.length !== t.cues.length) console.log(`    ${got.length} steps parsed, ${t.cues.length} expected`);
      } else {
        console.log(`  parsed back exactly: ${got.length} sets, type ${ev.type}`);
      }
    }
  } finally {
    for (const id of created) {
      try { await client.deleteEvent(id); } catch (e) { console.log(`  DELETE ${id} FAILED — remove it by hand: ${(e as Error).message}`); }
    }
    if (created.length) console.log(`\ndeleted ${created.length} verify event(s)`);
  }
  if (!COMMIT) console.log('\nDRY RUN — pass --commit to post, read back and delete.');
  if (failures) { console.log(`\n${failures} session(s) did not parse as rendered`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
