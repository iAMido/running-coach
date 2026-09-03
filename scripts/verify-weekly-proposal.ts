/**
 * Run the Saturday loop's decision against real data, WITHOUT writing.
 * Usage: bunx tsx scripts/verify-weekly-proposal.ts --env "<path>"
 */
import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
dotenv.config({ path: i >= 0 ? argv[i + 1] : '.env.local' });

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { buildTrainingState } = await import('../lib/coach/training-state');
  const { evaluateTriggers, shouldPropose, describeNoChange } = await import('../lib/coach/proposal-triggers');
  const { getActiveMacroPlan, phaseForWeek } = await import('../lib/coach/macro-plan');
  const { getActivePlan } = await import('../lib/db/plans');
  const { getAthleteProfile } = await import('../lib/db/profile');

  const { data } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (data as { user_id: string }).user_id;

  const profile = await getAthleteProfile(userId);
  const plan = await getActivePlan(userId);
  const [state, macro] = await Promise.all([
    buildTrainingState(userId, { profile, plan }),
    getActiveMacroPlan(userId),
  ]);

  const phase = macro ? phaseForWeek(macro, 1) : null;
  const triggers = evaluateTriggers({ state, phase, weeksIntoPhase: phase ? 1 : null });

  console.log(`active plan : ${plan ? plan.plan_type : 'none'}`);
  console.log(`macro plan  : ${macro ? `${macro.goal_name} (${macro.phases.length} phases)` : 'none'}`);
  console.log(`triggers    : ${triggers.length === 0 ? '(none)' : ''}`);
  for (const t of triggers) console.log(`   [${t.urgent ? 'URGENT' : 'soft'}] ${t.code}: ${t.detail}`);
  console.log(`\nwould propose: ${shouldPropose(triggers)}`);
  if (!shouldPropose(triggers)) console.log(`no-change note: ${describeNoChange(triggers)}`);
  console.log('\n(no writes made)');
}
main().catch(e => { console.error(e); process.exit(1); });
