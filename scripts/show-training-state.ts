/**
 * Print the assembled training state. Read-only, no writes, no LLM call.
 * Usage: bunx tsx scripts/show-training-state.ts --env "<path to .env.local>"
 */
import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
dotenv.config({ path: i >= 0 ? argv[i + 1] : '.env.local' });

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { buildTrainingState, formatTrainingState } = await import('../lib/coach/training-state');
  const { data } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const state = await buildTrainingState((data as { user_id: string }).user_id);
  console.log(formatTrainingState(state));
  console.log('\n--- weekly buckets ---');
  for (const w of state.weeks) {
    console.log(`  ${w.weekStart}  ${String(w.runs).padStart(2)} runs  ${String(w.km).padStart(5)} km  vert ${w.vertM === null ? 'n/a' : `${w.vertM}m (${w.vertMeasuredRuns}/${w.runs} measured)`}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
