/**
 * The season as it stands today: current phase, its KPIs measured against the
 * athlete's data, the recommendation, and the timeline. One assembly point for
 * the Season panel, the weekly reviewer, the Saturday proposal and the plan
 * builder's phase hand-over — so they cannot disagree about where he is.
 */

import { getActiveMacroPlan, type MacroPhase, type MacroPlan } from '@/lib/coach/macro-plan';
import { getAthleteProfile } from '@/lib/db/profile';
import { getActivePlan } from '@/lib/db/plans';
import { buildTrainingState, parseTrainingDays } from '@/lib/coach/training-state';
import { readinessForUser } from '@/lib/coach/readiness-service';
import { userDateStr } from '@/lib/utils/user-time';
import { evaluateKpis, formatKpiStatus, loadKpiData, type KpiStatus } from '@/lib/coach/phase-kpis';
import {
  currentPhase, raceSlackWeeks, recommend, timelineOf,
  type CurrentPhase, type Recommendation, type TimelineEntry,
} from '@/lib/coach/season-progress';

export interface SeasonStatus {
  macro: MacroPlan;
  current: CurrentPhase | null;
  statuses: KpiStatus[];
  recommendation: Recommendation | null;
  timeline: TimelineEntry[];
  raceSlackWeeks: number | null;
}

/** KPI statuses for one phase, measured from `since` (its actual start). */
export async function phaseKpiStatuses(userId: string, phase: MacroPhase, since: string): Promise<KpiStatus[]> {
  if (!phase.kpis?.length) return [];
  const profile = await getAthleteProfile(userId);
  const state = await buildTrainingState(userId, { profile }).catch(() => null);
  const data = await loadKpiData(userId, since, parseTrainingDays(profile?.training_days), {
    ctl: state?.load.ctl ?? null, form: state?.load.form ?? null,
  });
  return evaluateKpis(phase.kpis, data);
}

export async function seasonStatus(userId: string): Promise<SeasonStatus | null> {
  const macro = await getActiveMacroPlan(userId);
  if (!macro) return null;
  const today = userDateStr();
  const timeline = timelineOf(macro);
  const current = currentPhase(macro, today);
  const slack = raceSlackWeeks(macro);
  if (!current) return { macro, current, statuses: [], recommendation: null, timeline, raceSlackWeeks: slack };

  const statuses = current.weekOfPhase === null ? [] : await phaseKpiStatuses(userId, current.entry.phase, current.entry.start);
  const plan = await getActivePlan(userId).catch(() => null);
  const readiness = await readinessForUser(userId, plan).then((r) => r?.readiness?.verdict ?? null).catch(() => null);
  const recommendation = recommend(current, statuses, {
    isLastPhase: current.entry.phase.phase_number === macro.phases[macro.phases.length - 1].phase_number,
    readiness: readiness as 'GO' | 'EASY' | 'REST' | null,
    raceSlackWeeks: slack,
  });
  return { macro, current, statuses, recommendation, timeline, raceSlackWeeks: slack };
}

/** The KPI table for the weekly reviewer / Saturday proposal, or '' when there is no active phase. */
export async function kpiBlockFor(userId: string): Promise<string> {
  try {
    const s = await seasonStatus(userId);
    if (!s?.current || s.current.weekOfPhase === null || s.statuses.length === 0) return '';
    const c = s.current;
    return formatKpiStatus(
      `Phase ${c.entry.phase.phase_number}: ${c.entry.phase.name}`,
      c.entry.phase.goal,
      s.statuses,
      `week ${c.weekOfPhase} of ${c.entry.weeks}`,
    ) + (s.recommendation ? `\nPhase status: ${s.recommendation.message}` : '');
  } catch (err) {
    console.error('season KPI block unavailable:', err);
    return '';
  }
}

/** The season head coach's brief for one phase, rendered as the builder's contract. */
export function formatPhaseBrief(phase: MacroPhase, opts: { extensionWeeks?: number; carriedGaps?: string[]; previousOutcome?: string } = {}): string {
  const k = (phase.kpis ?? []).map((x) => `- ${x.label} (${x.metric} ${x.comparator === 'gte' ? '≥' : '≤'} ${x.target}${x.consecutive_weeks ? `, ${x.consecutive_weeks} weeks in a row` : ''})`);
  const lines = [
    `## THE SEASON HEAD COACH'S BRIEF FOR PHASE ${phase.phase_number}: ${phase.name} — YOUR CONTRACT`,
    opts.extensionWeeks
      ? `**This is a ${opts.extensionWeeks}-week EXTENSION of the phase.** Its KPIs were not met in time. Build these weeks to close the lagging KPIs below — same ranges, same don'ts, no new stressors.`
      : '',
    `Goal: ${phase.goal ?? phase.capability}`,
    phase.why_this_length ? `Why this long: ${phase.why_this_length}` : '',
    `Weekly km range: ${phase.weekly_km_range?.join('-') ?? 'n/a'}${phase.weekly_vert_range_m ? ` · weekly climbing: ${phase.weekly_vert_range_m.join('-')} m` : ''}${phase.long_run_vert_ceiling_m != null ? ` · single-session climb cap: ${phase.long_run_vert_ceiling_m} m` : ''}. Stay inside these bands.`,
    k.length ? `KPIs the app will measure every week — build the plan so each is reachable:\n${k.join('\n')}` : '',
    phase.must_haves?.length ? `Must-haves:\n${phase.must_haves.map((m) => `- ${m}`).join('\n')}` : '',
    opts.carriedGaps?.length ? `Carried over from the previous phase (now must-haves):\n${opts.carriedGaps.map((g) => `- ${g}`).join('\n')}` : '',
    phase.avoid?.length ? `Don'ts:\n${phase.avoid.map((m) => `- ${m}`).join('\n')}` : '',
    phase.watch_for?.length ? `Warning signs to build in checks for:\n${phase.watch_for.map((m) => `- ${m}`).join('\n')}` : '',
    phase.key_sessions?.length ? `Key sessions: ${phase.key_sessions.join('; ')}` : '',
    phase.handoff ? `Hand this to the next phase: ${phase.handoff}` : '',
    opts.previousOutcome ?? '',
  ];
  return lines.filter(Boolean).join('\n');
}
