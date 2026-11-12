/**
 * Morning-after coach note.
 *
 * When a sync imports a run, generate a two-sentence reaction in the coach's
 * voice and store it in runs.coach_notes. The dashboard hero surfaces it.
 *
 * Deliberately cheap: Haiku, tiny prompt, no RAG. Failure is always
 * non-fatal — a run without a note is just the old behaviour.
 *
 * ## Facts are computed here; the model only words them (2026-11-08)
 *
 * The first production note on 2026-11-08 got two facts wrong: it called an
 * average HR of 129 "Z3" (his Z2 is 124-143) and said "tomorrow's easy" the
 * day before a hill session. Neither was a model quirk — the prompt never
 * gave it his zone bands or tomorrow's session, yet asked it to judge
 * zones and "what tomorrow needs". A model asked about something it was not
 * told will make it up.
 *
 * So everything the note may assert is resolved in code (`buildRunFacts`):
 * which zone the average HR is in, where it sits against today's target,
 * and what tomorrow actually holds. Then `checkNote` rejects a note that
 * names a zone or a tomorrow the facts do not support; one retry with the
 * problem stated, then no note at all — no note beats a wrong one.
 */

import { callOpenRouter } from '@/lib/ai/openrouter';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { dateInUserTz } from '@/lib/utils/user-time';
import type { ZoneBands } from '@/lib/utils/zones';
import type { TrainingPlan, Workout } from '@/lib/db/types';

/**
 * What did the plan call for on the day this run happened?
 * Evaluates the run's date in the user's timezone, resolves the plan week
 * containing it, and picks that day's workout. Returns null when the plan
 * doesn't cover the date.
 */
export function plannedWorkoutForRunDate(
  plan: TrainingPlan | null | undefined,
  runDate: string | Date,
): { workout: Workout | null; phase: string | null } {
  if (!plan?.plan_json?.weeks || !plan.start_date) return { workout: null, phase: null };
  const localDate = dateInUserTz(new Date(runDate));
  const info = calculateCurrentWeek(plan.start_date, plan.duration_weeks, localDate);
  if (info.isBeforeStart || info.isAfterEnd) return { workout: null, phase: null };
  const week = plan.plan_json.weeks[info.currentWeek - 1];
  if (!week) return { workout: null, phase: null };
  const dayName = localDate.toLocaleDateString('en-US', { weekday: 'long' });
  const workout = week.workouts?.[dayName] ?? null;
  return { workout, phase: week.phase ?? null };
}

/**
 * Tomorrow's session, from the day after the run (user's timezone).
 * `covered` is false when the plan does not reach tomorrow (or there is no
 * plan): then nothing about tomorrow is known and the note must not say any.
 */
export function tomorrowFor(
  plan: TrainingPlan | null | undefined,
  runDate: string | Date,
): { covered: boolean; workout: Workout | null; dayName: string } {
  const next = new Date(new Date(runDate).getTime() + 24 * 3600 * 1000);
  const dayName = dateInUserTz(next).toLocaleDateString('en-US', { weekday: 'long' });
  if (!plan?.plan_json?.weeks || !plan.start_date) return { covered: false, workout: null, dayName };
  const info = calculateCurrentWeek(plan.start_date, plan.duration_weeks, dateInUserTz(next));
  if (info.isBeforeStart || info.isAfterEnd || !plan.plan_json.weeks[info.currentWeek - 1]) {
    return { covered: false, workout: null, dayName };
  }
  const w = plannedWorkoutForRunDate(plan, next).workout;
  return { covered: true, workout: isRest(w) ? null : w, dayName };
}

function isRest(w: Workout | null | undefined): boolean {
  return !w || !w.type || w.type === '—' || /^rest\b/i.test(w.type);
}

/** Which of his zones a heart rate falls in (bands share edges: 124 is Z2). */
export function zoneOfHr(bpm: number, bands: ZoneBands): number {
  const order = [bands.z1, bands.z2, bands.z3, bands.z4, bands.z5, bands.z6];
  for (let i = 0; i < order.length; i++) if (bpm < order[i].high) return i + 1;
  return 6;
}

/** "(110-124)" in a target_hr string -> {110, 124}. */
function targetBpm(s: string | undefined): { low: number; high: number } | null {
  const m = /\(\s*(\d{2,3})\s*[-–]\s*(\d{2,3})\s*\)/.exec(s ?? '');
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
}

/** Zone numbers a target_hr string names ("Z1-Z2 (…)" -> [1, 2]). */
function zonesNamed(s: string | undefined): number[] {
  const z = [...(s ?? '').matchAll(/z\s*([1-6])/gi)].map((m) => Number(m[1]));
  if (z.length === 2 && z[1] > z[0]) return Array.from({ length: z[1] - z[0] + 1 }, (_, i) => z[0] + i);
  return z;
}

const QUALITY = /hill|repeat|interval|tempo|threshold|vo2|fartlek|race|long|quality|strides|progression/i;

export interface RunReactionInput {
  distanceKm: number;
  durationMin: number;
  avgPaceStr?: string | null;
  avgHr?: number | null;
  runType?: string | null;
  zonePercents?: { z1?: number; z2?: number; z3?: number; z4?: number; z5?: number; z6?: number } | null;
  /** The athlete's own bands. Without them no zone may be named. */
  zoneBands?: ZoneBands | null;
  /** What the plan said today should be, if known. */
  plannedWorkout?: Workout | null;
  planPhase?: string | null;
  /** Tomorrow, from `tomorrowFor`. Absent = unknown. */
  tomorrow?: { covered: boolean; workout: Workout | null; dayName: string } | null;
}

export interface RunFacts {
  text: string;
  /** Zones the note may name: time spent ≥5%, the avg-HR zone, today's target zones. */
  allowedZones: Set<number>;
  tomorrow: 'unknown' | 'rest' | 'easy' | 'quality';
  /**
   * Today's effort against the plan's target HR, decided in code. The note
   * must agree with it: on 2026-11-09 a run averaging 138 inside a 130-155
   * target got "too conservative, you needed sharper Z4 work".
   */
  verdict: 'on_target' | 'above' | 'below' | 'unknown';
}

/** Every fact the note may state, resolved in code. Pure. */
export function buildRunFacts(input: RunReactionInput): RunFacts {
  const lines: string[] = [];
  const allowed = new Set<number>();
  const b = input.zoneBands;

  lines.push(`- ${input.distanceKm.toFixed(1)} km in ${Math.round(input.durationMin)} min${input.avgPaceStr ? ` @ ${input.avgPaceStr}/km` : ''}`);
  lines.push(`- Classified as: ${input.runType || 'unknown'}`);

  if (b) {
    lines.push(`- His HR zones: Z1 <${b.z1.high} · Z2 ${b.z2.low}-${b.z2.high} · Z3 ${b.z3.low}-${b.z3.high} · Z4 ${b.z4.low}-${b.z4.high} · Z5 ${b.z5.low}-${b.z5.high} · Z6 ${b.z6.low}+`);
  }
  if (input.avgHr) {
    if (b) {
      const z = zoneOfHr(input.avgHr, b);
      allowed.add(z);
      lines.push(`- Average HR ${input.avgHr} bpm — that is in HIS Z${z}.`);
    } else {
      lines.push(`- Average HR ${input.avgHr} bpm (his zone bands are unknown — do not name a zone for it).`);
    }
  }

  const z = input.zonePercents;
  if (z) {
    const parts = ([1, 2, 3, 4, 5, 6] as const).map((n) => {
      const pct = Math.round((z as Record<string, number | undefined>)[`z${n}`] ?? 0);
      if (pct >= 5) allowed.add(n);
      return `Z${n} ${pct}%`;
    });
    lines.push(`- Time in zones: ${parts.join(' / ')}`);
  } else {
    lines.push('- Time in zones: not measured');
  }

  let verdict: RunFacts['verdict'] = 'unknown';
  const p = input.plannedWorkout;
  if (p && !isRest(p)) {
    zonesNamed(p.target_hr).forEach((n) => allowed.add(n));
    lines.push(`- Planned today: ${p.type}${p.duration ? `, ${p.duration}` : ''}${p.distance ? `, ${p.distance}` : ''}${p.target_hr ? `, target HR ${p.target_hr}` : ''}${p.description ? ` — ${p.description}` : ''}`);
    const t = targetBpm(p.target_hr);
    if (t && input.avgHr) {
      const d = input.avgHr > t.high ? `${input.avgHr - t.high} bpm ABOVE the top of the target`
        : input.avgHr < t.low ? `${t.low - input.avgHr} bpm below the bottom of the target`
          : 'inside the target';
      lines.push(`- Average HR vs today's target (${t.low}-${t.high}): ${d}.`);
      verdict = input.avgHr > t.high ? 'above' : input.avgHr < t.low ? 'below' : 'on_target';
    }
  } else {
    lines.push(`- Planned today: ${p ? 'a rest day' : 'nothing on the plan (or no active plan)'}`);
  }
  if (input.planPhase) lines.push(`- Plan phase: ${input.planPhase}`);

  let tomorrow: RunFacts['tomorrow'] = 'unknown';
  const tm = input.tomorrow;
  if (tm?.covered) {
    if (!tm.workout) {
      tomorrow = 'rest';
      lines.push(`- Tomorrow (${tm.dayName}): rest day.`);
    } else {
      tomorrow = QUALITY.test(tm.workout.type) ? 'quality' : 'easy';
      lines.push(`- Tomorrow (${tm.dayName}): ${tm.workout.type}${tm.workout.duration ? `, ${tm.workout.duration}` : ''}${tm.workout.description ? ` — ${tm.workout.description}` : ''}`);
    }
  } else {
    lines.push('- Tomorrow: not known — do NOT mention tomorrow.');
  }

  lines.push(
    verdict === 'on_target' ? '- VERDICT: effort was ON TARGET for the plan. Say so. Do NOT ask for more or less intensity, and do not call it too conservative or too hard.'
      : verdict === 'above' ? "- VERDICT: effort was ABOVE the plan's target. Do NOT ask for more intensity."
        : verdict === 'below' ? "- VERDICT: effort was BELOW the plan's target. Do NOT call it too hard."
          : '- VERDICT: no target to judge against — do not say the effort was too hard or too easy.',
  );

  return { text: lines.join('\n'), allowedZones: allowed, tomorrow, verdict };
}

/** "Go harder" language. */
const PUSH = /\b(push|harder|sharper|more intensity|commit to the intensity|too (conservative|easy|soft|cautious)|not hard enough|step it up|needed (more|sharper|harder))\b/i;
/** "Back off" language. */
const EASE = /\b(too (hard|fast|high|hot)|ease (off|up|back)|dial (it )?back|back off|slow (it )?down|reel it in|went out too)\b/i;

/** Problems with a note against its facts; [] when it is fine. Pure. */
export function checkNote(note: string, facts: RunFacts): string[] {
  const problems: string[] = [];
  const named = [...note.matchAll(/\b(?:z|zone\s*)([1-6])\b/gi)].map((m) => Number(m[1]));
  const bad = [...new Set(named.filter((n) => !facts.allowedZones.has(n)))];
  if (bad.length) problems.push(`it names ${bad.map((n) => `Z${n}`).join(', ')}, which the facts do not support`);

  const sentences = note.split(/(?<=[.!?])\s+/);
  const aboutTomorrow = sentences.filter((s) => /\btomorrow/i.test(s));
  if (aboutTomorrow.length && facts.tomorrow === 'unknown') problems.push('it mentions tomorrow, which is not known');
  if (facts.tomorrow === 'quality' && aboutTomorrow.some((s) => /\b(easy|rest|recovery|off)\b/i.test(s) && !/\b(hill|interval|tempo|threshold|quality|hard|long|repeat)/i.test(s))) {
    problems.push('it describes tomorrow as easy, but tomorrow is a quality session');
  }
  if (facts.tomorrow === 'rest' && aboutTomorrow.some((s) =>
    /\b(hill|interval|tempo|threshold|repeat|long run|session|push|harder|intensity|climbs?|pace|run)\b/i.test(s) && !/\b(rest|off|recover)/i.test(s))) {
    problems.push('it gives tomorrow a session, but tomorrow is a rest day');
  }

  // Today's sentences are judged against the verdict; tomorrow's advice is checked above.
  const aboutToday = sentences.filter((s) => !/\btomorrow/i.test(s)).join(' ');
  if ((facts.verdict === 'on_target' || facts.verdict === 'above') && PUSH.test(aboutToday)) {
    problems.push(`it asks for more intensity, but today's effort was ${facts.verdict === 'above' ? 'above' : 'on'} the plan's target`);
  }
  if ((facts.verdict === 'on_target' || facts.verdict === 'below') && EASE.test(aboutToday)) {
    problems.push(`it says the effort was too hard, but it was ${facts.verdict === 'below' ? 'below' : 'on'} the plan's target`);
  }
  if (facts.verdict === 'unknown' && (PUSH.test(note) || EASE.test(note))) {
    problems.push('it judges the effort, but there was no target to judge against');
  }
  return problems;
}

const REACTION_SYSTEM_PROMPT = `You are the athlete's running coach reacting to a run that just synced from their watch. Write EXACTLY two short sentences, in the coach's voice, direct and personal:
- Sentence 1: acknowledge what they actually did (distance/pace/HR — be specific with one number).
- Sentence 2: one actionable observation — pacing discipline, HR vs the day's target, zone distribution vs what the day called for, or what tomorrow holds.

Rules:
- Use ONLY the facts given. Every zone you name must match the facts exactly: the zone of the average HR is stated — never re-derive it from the numbers.
- Mention tomorrow only as the facts describe it; if tomorrow is not known, say nothing about it.
- The VERDICT line is decided for you — agree with it. On target means say it was on target, never 'push harder'. A few bpm over a recovery target is a mild note, not a scolding.
- If zones show >35% in Z4+ on an easy/recovery day, call it out firmly but kindly.
- No greetings, no emoji, no hashtags, no "great job" filler. Coach, not cheerleader.
- Max 45 words total.`;

export async function generateRunReaction(input: RunReactionInput): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const facts = buildRunFacts(input);
  const userPrompt = `RUN JUST SYNCED — FACTS:\n${facts.text}`;

  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await callOpenRouter(
        [
          { role: 'system', content: REACTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt + feedback },
        ],
        { apiKey, model: MODEL_FOR.chat_quick, maxTokens: 120 },
      );
      if (resp.error || !resp.content) return null;
      const text = resp.content.trim();
      const problems = checkNote(text, facts);
      // Guard against runaway output — the note lives in a small card.
      if (!problems.length) return text.length > 400 ? text.slice(0, 400) : text;
      console.warn('run note rejected:', problems.join('; '), '—', text);
      feedback = `\n\nYour previous note was wrong: ${problems.join('; ')}. Write it again from the facts.`;
    } catch {
      return null;
    }
  }
  return null; // no note beats a wrong one
}
