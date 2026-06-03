/**
 * Weekly health audit — the supervisor's third pillar.
 *
 * Runs on a Vercel cron (Sunday night). For each user with activity:
 *   - Coverage: are runs / feedback / weekly summaries being logged?
 *   - Plan health: is current_week_num drifting vs start_date?
 *   - RAG health: are book embeddings 100%? coach_phases populated?
 *   - AI quality: avg critic score this week vs previous; ceiling-hit rate.
 * Writes a markdown report into runcoach.coach_reports
 * (report_type='system_health') so it shows up in the existing Reports UI.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as /api/cron/strava-sync.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

interface CoverageRow {
  user_id: string;
  runs_7d: number;
  feedback_7d: number;
  feedback_coverage_pct: number;
  weekly_summary_logged: boolean;
}

interface PlanDrift {
  plan_id: string;
  stored_week: number;
  expected_week: number;
  drift: number;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const weekStart = startOfIsoWeek(now);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const reports: Array<{ user_id: string; ok: boolean; error?: string }> = [];

  // Iterate per user (we currently expect 1; loop tolerates more).
  const { data: users } = await supabase
    .from('athlete_profile')
    .select('user_id');

  if (!users || users.length === 0) {
    return NextResponse.json({ message: 'No users found' });
  }

  for (const u of users) {
    const userId = u.user_id;
    try {
      const markdown = await buildReportForUser(userId, weekStart);
      const title = `System Health: ${weekStartStr} — ${weekEndStr}`;

      const { error } = await supabase
        .from('coach_reports')
        .upsert(
          {
            user_id: userId,
            report_type: 'system_health',
            title,
            content: markdown,
            week_start: weekStartStr,
            week_end: weekEndStr,
            metadata: { generated_at: now.toISOString() },
          },
          { onConflict: 'user_id,week_start,report_type' },
        );

      if (error) {
        reports.push({ user_id: userId, ok: false, error: error.message });
      } else {
        reports.push({ user_id: userId, ok: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      reports.push({ user_id: userId, ok: false, error: msg });
    }
  }

  return NextResponse.json({ success: true, reports });
}

// ── Building blocks ─────────────────────────────────────────────────────

async function buildReportForUser(userId: string, weekStart: Date): Promise<string> {
  const lines: string[] = [];
  lines.push(`# System Health — Week of ${weekStart.toISOString().split('T')[0]}`);
  lines.push('');
  lines.push(
    'Automated weekly audit. Each section flags whether the AI coach has what it needs to give good advice. Anything in **🔴** needs your attention.',
  );
  lines.push('');

  // 1. Coverage
  const coverage = await coverageForUser(userId, weekStart);
  lines.push('## Run & feedback coverage');
  lines.push(`- Runs logged this week: **${coverage.runs_7d}**`);
  lines.push(`- Feedback entries: **${coverage.feedback_7d}** (${coverage.feedback_coverage_pct}% of runs)`);
  lines.push(`- Weekly check-in submitted: ${coverage.weekly_summary_logged ? '✅' : '⚠️ no'}`);
  if (coverage.runs_7d > 0 && coverage.feedback_coverage_pct < 30) {
    lines.push(
      '\n> 🔴 Less than 30% of runs have feedback. The coach is missing the qualitative signal (how it felt, comments).',
    );
  }
  lines.push('');

  // 2. Plan drift
  const drift = await planDriftForUser(userId);
  lines.push('## Active plan');
  if (drift.length === 0) {
    lines.push('- No active plan.');
  } else {
    for (const d of drift) {
      const flag = Math.abs(d.drift) > 0 ? `⚠️ drift ${d.drift > 0 ? '+' : ''}${d.drift}` : '✅ in sync';
      lines.push(`- Plan ${d.plan_id.slice(0, 8)} — stored week ${d.stored_week}, expected ${d.expected_week} ${flag}`);
    }
  }
  lines.push('');

  // 3. RAG knowledge base health
  const rag = await ragHealth();
  lines.push('## Knowledge base');
  lines.push(`- book_instructions embedded: **${rag.embedded}/${rag.total}** (${rag.pct.toFixed(1)}%)`);
  lines.push(`- coach_workouts with notes: **${rag.coachWorkoutsWithNotes}/${rag.coachWorkoutsTotal}**`);
  lines.push(`- coach_phases: **${rag.coachPhases}**`);
  if (rag.pct < 100) {
    lines.push(`\n> 🔴 ${rag.total - rag.embedded} book chunks missing embeddings — semantic search silently skips them.`);
  }
  if (rag.coachPhases === 0) {
    lines.push('\n> 🔴 coach_phases empty — the phase layer of the RAG returns nothing.');
  }
  lines.push('');

  // 4. AI call quality
  const ai = await aiQuality(userId, weekStart);
  lines.push('## AI coach quality (last 7 days)');
  lines.push(`- Calls: **${ai.totalCalls}** | errors: ${ai.errors} | avg latency: ${ai.avgLatencyMs}ms`);
  lines.push(`- Preflight warnings raised: **${ai.preflightWarnings}**`);
  lines.push(`- Hit token ceiling (>=95% budget) on: ${ai.ceilingHits} calls`);
  if (ai.criticCount > 0) {
    lines.push(`- Critic average overall score: **${ai.criticAvgOverall.toFixed(2)}/5** (n=${ai.criticCount})`);
    lines.push(
      `  - addresses_question: ${ai.criticAvg.addresses_question.toFixed(2)} | ` +
        `plan_day: ${ai.criticAvg.references_plan_day.toFixed(2)} | ` +
        `runs/feedback: ${ai.criticAvg.references_runs_feedback.toFixed(2)} | ` +
        `pace/HR: ${ai.criticAvg.specific_pace_hr.toFixed(2)} | ` +
        `consistency: ${ai.criticAvg.no_contradiction.toFixed(2)}`,
    );
  } else {
    lines.push('- Critic: no audits this week (run /api/coach/chat/ask once to generate).');
  }
  if (ai.topWarningCodes.length > 0) {
    lines.push(`\nMost common preflight warnings: ${ai.topWarningCodes.map(w => `\`${w.code}\` (${w.count})`).join(', ')}`);
  }
  lines.push('');

  lines.push('---');
  lines.push('*Generated automatically by `/api/cron/weekly-health-audit`.*');
  return lines.join('\n');
}

async function coverageForUser(userId: string, weekStart: Date): Promise<CoverageRow> {
  const startStr = weekStart.toISOString();
  const startDateStr = weekStart.toISOString().split('T')[0];

  const { data: runs } = await supabase
    .from('runs')
    .select('id')
    .eq('user_id', userId)
    .gte('date', startStr);

  const runIds = (runs || []).map(r => r.id);
  let feedbackCount = 0;
  if (runIds.length > 0) {
    const { count } = await supabase
      .from('run_feedback')
      .select('id', { count: 'exact', head: true })
      .in('run_id', runIds);
    feedbackCount = count || 0;
  }

  const { data: weeklySummary } = await supabase
    .from('weekly_summaries')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', startDateStr)
    .maybeSingle();

  const runsCount = runIds.length;
  const pct = runsCount > 0 ? Math.round((feedbackCount / runsCount) * 100) : 0;

  return {
    user_id: userId,
    runs_7d: runsCount,
    feedback_7d: feedbackCount,
    feedback_coverage_pct: pct,
    weekly_summary_logged: !!weeklySummary,
  };
}

async function planDriftForUser(userId: string): Promise<PlanDrift[]> {
  const { data } = await supabase
    .from('training_plans')
    .select('id, start_date, duration_weeks, current_week_num')
    .eq('user_id', userId)
    .eq('status', 'active');

  const drift: PlanDrift[] = [];
  for (const p of data || []) {
    if (!p.start_date) continue;
    // Same Sunday-anchored math as lib/utils/week-calculator
    const planStart = new Date(p.start_date);
    planStart.setHours(0, 0, 0, 0);
    const week1Start = new Date(planStart);
    week1Start.setDate(week1Start.getDate() - week1Start.getDay());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay());
    const msPerDay = 24 * 60 * 60 * 1000;
    const weeksDiff = Math.floor((currentWeekStart.getTime() - week1Start.getTime()) / msPerDay / 7);
    const expected = Math.max(1, Math.min(p.duration_weeks, weeksDiff + 1));
    drift.push({
      plan_id: p.id,
      stored_week: p.current_week_num,
      expected_week: expected,
      drift: expected - (p.current_week_num ?? expected),
    });
  }
  return drift;
}

async function ragHealth() {
  const [
    { count: total },
    { count: embedded },
    { count: coachWorkoutsTotal },
    { count: coachWorkoutsWithNotes },
    { count: coachPhases },
  ] = await Promise.all([
    supabase.from('book_instructions').select('id', { count: 'exact', head: true }),
    supabase.from('book_instructions').select('id', { count: 'exact', head: true }).not('embedding', 'is', null),
    supabase.from('coach_workouts').select('id', { count: 'exact', head: true }),
    supabase
      .from('coach_workouts')
      .select('id', { count: 'exact', head: true })
      .not('coach_notes', 'is', null)
      .neq('coach_notes', ''),
    supabase.from('coach_phases').select('id', { count: 'exact', head: true }),
  ]);

  const tot = total || 0;
  const emb = embedded || 0;
  return {
    total: tot,
    embedded: emb,
    pct: tot > 0 ? (emb / tot) * 100 : 0,
    coachWorkoutsTotal: coachWorkoutsTotal || 0,
    coachWorkoutsWithNotes: coachWorkoutsWithNotes || 0,
    coachPhases: coachPhases || 0,
  };
}

async function aiQuality(userId: string, weekStart: Date) {
  const startStr = weekStart.toISOString();

  const { data: calls } = await supabase
    .from('coach_calls')
    .select('id, latency_ms, status, ceiling_hit, preflight_warnings')
    .eq('user_id', userId)
    .gte('created_at', startStr);

  const list = calls || [];
  const totalCalls = list.length;
  const errors = list.filter(c => c.status === 'error').length;
  const ceilingHits = list.filter(c => c.ceiling_hit).length;
  const avgLatencyMs = totalCalls
    ? Math.round(list.reduce((s, c) => s + (c.latency_ms || 0), 0) / totalCalls)
    : 0;

  // Tally warning codes across calls
  const warningCounts: Record<string, number> = {};
  let preflightWarnings = 0;
  for (const c of list) {
    const arr = (c.preflight_warnings as string[] | null) || [];
    preflightWarnings += arr.length;
    for (const w of arr) {
      const code = w.split(':')[0];
      warningCounts[code] = (warningCounts[code] || 0) + 1;
    }
  }
  const topWarningCodes = Object.entries(warningCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => ({ code, count }));

  // Critic scores
  const { data: audits } = await supabase
    .from('coach_response_audits')
    .select('overall_score, scores')
    .eq('user_id', userId)
    .gte('created_at', startStr)
    .not('overall_score', 'is', null);

  const auditList = audits || [];
  const criticCount = auditList.length;
  const criticAvgOverall = criticCount
    ? auditList.reduce((s, a) => s + Number(a.overall_score), 0) / criticCount
    : 0;

  const axisSum = { addresses_question: 0, references_plan_day: 0, references_runs_feedback: 0, specific_pace_hr: 0, no_contradiction: 0 };
  for (const a of auditList) {
    const s = (a.scores as typeof axisSum | null) || axisSum;
    for (const k of Object.keys(axisSum) as Array<keyof typeof axisSum>) {
      axisSum[k] += Number(s[k] || 0);
    }
  }
  const criticAvg = criticCount
    ? Object.fromEntries(Object.entries(axisSum).map(([k, v]) => [k, v / criticCount])) as typeof axisSum
    : axisSum;

  return {
    totalCalls,
    errors,
    avgLatencyMs,
    preflightWarnings,
    ceilingHits,
    topWarningCodes,
    criticCount,
    criticAvgOverall,
    criticAvg,
  };
}

function startOfIsoWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
