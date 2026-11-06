/**
 * One-off: give an existing plan's sessions watch steps (2026-11-06).
 *
 * Plans built before `steps` existed carry their structure only as free text.
 * This converts the two shapes those plans use, and REFUSES anything else
 * rather than guess (a mis-parsed interval session on the wrist is worse than
 * a correct steady one, so an unrecognised session keeps no steps and still
 * goes out as one steady step):
 *   - easy / recovery / long runs → one steady step at the plan's target_hr
 *   - hill reps "WU [N min] | Kx S s uphill …, walk|jog down | CD [N min]"
 *     → warm-up, K × (work S s / recovery), cool-down, sized to the duration
 *
 *   bun --env-file=<.env.local> scripts/add-plan-steps.ts [--plan <id>] [--commit]
 *
 * Without --commit it prints every conversion and writes nothing. With it,
 * the old plan_json is saved to runcoach._bak_20261106_plan_steps first.
 * Auto-sync then re-pushes the current and next week, because the week hash
 * includes the workouts.
 */

import { supabase } from '@/lib/db/supabase';
import type { PlanStep, PlanWeek, Workout } from '@/lib/db/types';
import { parseDurationMinutes } from '@/lib/intervals/workout-format';
import { checkWorkoutSteps, describePlanSteps } from '@/lib/coach/plan-steps';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const planArg = args[args.indexOf('--plan') + 1];

const STEADY = /\b(easy|recovery|long run|aerobic)\b/i;
const HILLS = /(\d+)\s*x\s*(\d+)\s*s(?:ec)?\b[^|]*uphill/i;

export function stepsFor(w: Workout): PlanStep[] | null {
  const minutes = parseDurationMinutes(w.duration);
  if (!minutes || !w.target_hr) return null;
  const desc = w.description ?? '';
  const hills = HILLS.exec(desc);

  if (hills) {
    const reps = Number(hills[1]);
    const workSec = Number(hills[2]);
    const recSec = /walk/i.test(desc) ? Math.max(90, workSec * 2) : Math.max(90, Math.round(workSec * 1.5));
    const setMin = (reps * (workSec + recSec)) / 60;
    const wu = Number(/WU\s*(\d+)\s*min/i.exec(desc)?.[1]) || null;
    const cd = Number(/CD\s*(\d+)\s*min/i.exec(desc)?.[1]) || null;
    const rest = Math.max(10, minutes - setMin);
    const warm = wu ?? Math.round(cd ? rest - cd : rest * 0.55);
    const cool = cd ?? Math.max(5, Math.round(rest - warm));
    return [
      { kind: 'warmup', min: warm, hr: 'Z1-Z2 (115-140)', cue: 'Easy jog' },
      {
        kind: 'repeat', reps, steps: [
          { kind: 'work', sec: workSec, hr: w.target_hr, cue: 'Hard uphill' },
          { kind: 'recovery', sec: recSec, cue: /walk/i.test(desc) ? 'Walk down' : 'Jog down' },
        ],
      },
      { kind: 'cooldown', min: cool, hr: 'Z1 (100-124)', cue: 'Easy jog' },
    ];
  }

  if (STEADY.test(w.type) && !/\d+\s*x\s*\d/i.test(desc)) {
    const cue = /recovery/i.test(w.type) ? 'Recovery jog' : /long/i.test(w.type) ? 'Easy long' : 'Easy';
    return [{ kind: 'steady', min: minutes, hr: w.target_hr, cue }];
  }
  return null;
}

async function main() {
  const q = supabase.from('training_plans').select('id,user_id,plan_json');
  const { data: plan, error } = planArg && !planArg.startsWith('--')
    ? await q.eq('id', planArg).single()
    : await q.eq('status', 'active').limit(1).single();
  if (error || !plan) throw new Error(`plan not found: ${error?.message}`);

  const weeks = (plan.plan_json?.weeks ?? []) as PlanWeek[];
  let converted = 0, refused = 0, already = 0;
  for (const week of weeks) {
    for (const [day, w] of Object.entries((week.workouts ?? {}) as Record<string, Workout>)) {
      if (!w?.type || w.type === '—') continue;
      if (w.steps?.length) { already++; continue; }
      const steps = stepsFor(w);
      if (!steps) {
        refused++;
        console.log(`  W${week.week_number} ${day} ${w.type}: NOT converted — "${w.description ?? ''}"`);
        continue;
      }
      const problems = checkWorkoutSteps({ ...w, steps });
      if (problems.some((p) => p.severity === 'error')) {
        refused++;
        console.log(`  W${week.week_number} ${day} ${w.type}: REFUSED — ${problems.map((p) => p.message).join('; ')}`);
        continue;
      }
      w.steps = steps;
      converted++;
      console.log(`  W${week.week_number} ${day} ${w.type} (${w.duration}): ${describePlanSteps(steps)}`);
    }
  }
  console.log(`\n${converted} converted, ${refused} left as steady, ${already} already had steps.`);
  if (!commit) { console.log('Dry run — nothing written. Re-run with --commit.'); return; }

  const { data: original } = await supabase.from('training_plans').select('plan_json').eq('id', plan.id).single();
  const { error: bakErr } = await supabase.from('_bak_20261106_plan_steps')
    .insert({ plan_id: plan.id, plan_json: original!.plan_json });
  if (bakErr) throw new Error(`backup failed, nothing written: ${bakErr.message}`);
  const { error: upErr } = await supabase.from('training_plans')
    .update({ plan_json: { ...plan.plan_json, weeks } }).eq('id', plan.id);
  if (upErr) throw new Error(upErr.message);
  console.log(`Saved plan ${plan.id}. Backup in runcoach._bak_20261106_plan_steps.`);
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
