/**
 * Coach Health endpoint — aggregates the supervisor's telemetry over the
 * last 7 days into a tiny summary the dashboard can render. Same data the
 * weekly cron emits as markdown, but always-fresh and JSON.
 *
 * Anyone authenticated can fetch their own stats. No model selection or
 * RAG involved — pure SQL aggregation.
 */

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

interface CallRow {
  status: string | null;
  ceiling_hit: boolean | null;
  preflight_warnings: string[] | null;
  latency_ms: number | null;
}
interface AuditRow {
  overall_score: number | null;
  scores: Record<string, number> | null;
}

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: callsRaw }, { data: auditsRaw }] = await Promise.all([
    supabase
      .from('coach_calls')
      .select('status, ceiling_hit, preflight_warnings, latency_ms')
      .eq('user_id', auth.userId)
      .gte('created_at', since),
    supabase
      .from('coach_response_audits')
      .select('overall_score, scores')
      .eq('user_id', auth.userId)
      .gte('created_at', since)
      .not('overall_score', 'is', null),
  ]);

  const calls = (callsRaw || []) as CallRow[];
  const audits = (auditsRaw || []) as AuditRow[];

  const totalCalls = calls.length;
  const errors = calls.filter(c => c.status === 'error').length;
  const ceilingHits = calls.filter(c => c.ceiling_hit).length;
  const avgLatencyMs = totalCalls
    ? Math.round(calls.reduce((s, c) => s + (c.latency_ms || 0), 0) / totalCalls)
    : 0;

  const warningCounts: Record<string, number> = {};
  let preflightWarnings = 0;
  for (const c of calls) {
    const arr = c.preflight_warnings || [];
    preflightWarnings += arr.length;
    for (const w of arr) {
      const code = w.split(':')[0];
      warningCounts[code] = (warningCounts[code] || 0) + 1;
    }
  }
  const topWarnings = Object.entries(warningCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, count }));

  const criticCount = audits.length;
  const criticAvg = criticCount
    ? Math.round((audits.reduce((s, a) => s + Number(a.overall_score || 0), 0) / criticCount) * 10) / 10
    : null;

  return NextResponse.json({
    window: { days: 7, since },
    totalCalls,
    errors,
    ceilingHits,
    avgLatencyMs,
    preflightWarnings,
    topWarnings,
    criticCount,
    criticAvgOverall: criticAvg,
  });
}
