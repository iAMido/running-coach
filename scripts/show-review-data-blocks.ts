/**
 * READ-ONLY: prints the efficiency block and the lap block for this week's runs
 * exactly as the weekly review renders them. No AI call, no writes.
 *
 * Usage: bun scripts/show-review-data-blocks.ts [--env ../../../.env.local]
 */
import * as dotenv from 'dotenv';

const argv = process.argv;
const envIdx = argv.indexOf('--env');
dotenv.config({ path: envIdx >= 0 ? argv[envIdx + 1] : '.env.local' });

(async () => {
  const { supabase } = await import('../lib/db/supabase');
  const { getEfficiencyRuns, formatRunLaps } = await import('../lib/rag/user-formatter');
  const { buildEfficiencySummary, formatEfficiency } = await import('../lib/utils/efficiency');
  const { userDateStr, nowInUserTz } = await import('../lib/utils/user-time');

  const { data: users } = await supabase.from('athlete_profile').select('user_id').limit(1);
  const userId = users?.[0]?.user_id as string;

  console.log(formatEfficiency(buildEfficiencySummary(await getEfficiencyRuns(userId), userDateStr())) || '(empty)');

  const now = nowInUserTz();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);
  const { data: runs } = await supabase.from('runs').select('id,date,run_type').eq('user_id', userId)
    .gte('date', sunday.toISOString()).order('date');
  for (const r of runs ?? []) {
    const { data: laps } = await supabase.from('laps').select('*').eq('run_id', r.id).order('lap_number');
    console.log(`\n${r.date} ${r.run_type}\n${formatRunLaps(laps ?? []) || '  (no lap block)'}`);
  }
})();
