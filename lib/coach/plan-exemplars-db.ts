/**
 * Read side of the expert plan library. Separate from plan-exemplars.ts so the
 * distiller and selector stay pure and testable without a database.
 */

import { supabase } from '@/lib/db/supabase';
import {
  selectExemplars,
  selectStrengthReference,
  type ExemplarKind,
  type ExemplarRequest,
  type SelectableExemplar,
} from '@/lib/coach/plan-exemplars';

interface ExemplarRow {
  source_key: string;
  name: string;
  kind: ExemplarKind;
  tags: string[];
  weeks: number;
  goal_distance_km: number | null;
  goal_elevation_gain_m: number | null;
  goal_elevation_loss_m: number | null;
  rendered: string;
}

type Loaded = SelectableExemplar & { rendered: string };

async function loadAll(): Promise<Loaded[]> {
  const { data, error } = await supabase
    .from('plan_exemplars')
    .select('source_key,name,kind,tags,weeks,goal_distance_km,goal_elevation_gain_m,goal_elevation_loss_m,rendered');
  if (error) {
    console.error('plan-exemplars: load failed:', error.message);
    return [];
  }
  return ((data ?? []) as ExemplarRow[]).map((r) => ({
    sourceKey: r.source_key,
    name: r.name,
    kind: r.kind,
    tags: r.tags ?? [],
    weeks: r.weeks,
    goal: {
      distanceKm: r.goal_distance_km === null ? null : Number(r.goal_distance_km),
      elevationGainM: r.goal_elevation_gain_m,
      elevationLossM: r.goal_elevation_loss_m,
    },
    rendered: r.rendered,
  }));
}

export interface ExemplarSelection {
  /** Names only — for telemetry, tests and the plan's own `sources` field. */
  structureNames: string[];
  strengthName: string | null;
  /** Prompt block, or '' when the library is empty. */
  text: string;
}

/**
 * The prompt block for plan or season generation: the 2 most structurally
 * similar expert plans, plus one strength-only block as an exercise reference.
 *
 * Returns an EMPTY block, not a placeholder, when the library has nothing —
 * generation then proceeds exactly as it did before the library existed.
 */
export async function exemplarsForRequest(req: ExemplarRequest): Promise<ExemplarSelection> {
  const all = await loadAll();
  if (!all.length) return { structureNames: [], strengthName: null, text: '' };

  const structure = selectExemplars(all, req, 2);
  const strength = selectStrengthReference(all, req.age);

  const parts: string[] = [
    '## REFERENCE PLANS FROM EXPERT COACHES',
    'These are real plans built by experienced coaches for comparable goals, chosen for this',
    'request by terrain, distance and goal. Use them to learn HOW a plan like this is built —',
    'phase lengths, how volume and climb progress, where recovery weeks fall and how deep they',
    'are, how strength is placed around the running and how it progresses, and the reasoning',
    'the coach gives at each stage.',
    '',
    '**Learn the structure. Do NOT copy the sessions.** This athlete has his own training days,',
    'his own race, his own measured history and his own injury history, all stated above — the',
    'plan must fit him, not these examples. Days in the references are RELATIVE (day1..day7),',
    'never weekdays: map the rhythm onto HIS training days. Where a reference and the methodology',
    'books disagree, say which you followed and why.',
    '',
  ];
  for (const ex of structure) parts.push(ex.rendered, '');
  if (strength) {
    parts.push(
      '### Strength reference (exercise selection and loading only — not a plan structure)',
      strength.rendered,
      '',
    );
  }

  return {
    structureNames: structure.map((e) => e.name),
    strengthName: strength?.name ?? null,
    text: parts.join('\n'),
  };
}
