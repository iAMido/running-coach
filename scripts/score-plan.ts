/**
 * READ-ONLY: score a plan with the staged builder's rule checker.
 *
 * Usage:
 *   bunx tsx scripts/score-plan.ts --env .env.local                 # active plan
 *   bunx tsx scripts/score-plan.ts --file test-plan-output.json    # a saved plan JSON
 *   bunx tsx scripts/score-plan.ts --recent 5                      # last 5 plans in the DB
 *   options: --race (plan ends in a race) --days Sunday,Monday,... --runs 4 --warnings
 *
 * Exists so "the staged builder is better" is a measurement: the same rules
 * run over plans from the old single-call generator and the new pipeline.
 * Outline-dependent rules are skipped for plans that have no outline.
 */
import * as dotenv from 'dotenv';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
dotenv.config({ path: flag('--env') ?? '.env.local' });

(async () => {
  const fs = await import('fs');
  const { checkPlan, scoreViolations, isRun } = await import('../lib/coach/plan-builder/checks');
  const { parseZonesFromProfile } = await import('../lib/utils/zones');
  const { parseTrainingDays } = await import('../lib/coach/training-state');
  const { supabase } = await import('../lib/db/supabase');
  type PlanWeek = import('../lib/db/types').PlanWeek;

  const { data: prof } = await supabase.from('athlete_profile').select('*').limit(1).maybeSingle();
  const zones = parseZonesFromProfile(prof);

  const plans: { label: string; json: { weeks?: PlanWeek[]; strength_sessions?: Record<string, unknown> } }[] = [];
  if (flag('--file')) {
    plans.push({ label: flag('--file')!, json: JSON.parse(fs.readFileSync(flag('--file')!, 'utf8')) });
  } else {
    const n = Number(flag('--recent') ?? 1);
    const { data } = await supabase.from('training_plans').select('id, plan_type, created_at, status, plan_json')
      .order('created_at', { ascending: false }).limit(n);
    for (const p of data ?? []) plans.push({ label: `${p.created_at.slice(0, 10)} ${p.plan_type} (${p.status})`, json: p.plan_json });
  }

  for (const { label, json } of plans) {
    const weeks = json.weeks ?? [];
    if (weeks.length === 0) { console.log(`\n${label}: no weeks`); continue; }
    const runsPerWeek = Number(flag('--runs') ?? Math.max(...weeks.map((w) => Object.values(w.workouts ?? {}).filter((x) => isRun(x)).length)));
    const days = flag('--days')?.split(',') ?? parseTrainingDays(prof?.training_days);
    const v = checkPlan(weeks, {
      expectedWeeks: weeks.length, allowedDays: days, runsPerWeek,
      hasElevation: weeks.some((w) => typeof w.total_elevation_gain_m === 'number'),
      hasRace: argv.includes('--race'), zones,
      // Plans saved by the old generator have references already expanded.
      strengthLibrary: null,
    });
    const s = scoreViolations(v);
    console.log(`\n${label}: ${weeks.length} weeks · ${s.errors} errors · ${s.warnings} warnings`);
    console.log('  by rule:', JSON.stringify(s.byRule));
    for (const x of v.filter((x) => x.severity === 'error').slice(0, 12)) console.log(`  ✗ W${x.week}${x.day ? ` ${x.day}` : ''} [${x.rule}] ${x.message}`);
    if (argv.includes('--warnings')) {
      const seen = new Set<string>();
      for (const x of v.filter((x) => x.severity === 'warn')) {
        if (seen.has(x.message)) continue;
        seen.add(x.message);
        console.log(`  · W${x.week}${x.day ? ` ${x.day}` : ''} [${x.rule}] ${x.message}`);
      }
    }
  }
})();
