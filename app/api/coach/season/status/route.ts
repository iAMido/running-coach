/**
 * GET the active season as it stands: current phase, its KPIs measured against
 * the athlete's data, the recommendation (build next / carry a gap / extend),
 * and every phase's actual or projected dates. See lib/coach/season-status.ts.
 */

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { seasonStatus } from '@/lib/coach/season-status';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const s = await seasonStatus(auth.userId);
    if (!s) return NextResponse.json({ status: null });
    return NextResponse.json({
      status: {
        macroPlanId: s.macro.id,
        current: s.current && {
          phaseNumber: s.current.entry.phase.phase_number,
          name: s.current.entry.phase.name,
          weekOfPhase: s.current.weekOfPhase,
          weeks: s.current.entry.weeks,
          weeksLeft: s.current.weeksLeft,
          built: s.current.built,
        },
        kpis: s.statuses.map((x) => ({ label: x.kpi.label, target: x.kpi.target, comparator: x.kpi.comparator, current: x.current, met: x.met, trend: x.trend, detail: x.detail })),
        recommendation: s.recommendation,
        raceSlackWeeks: s.raceSlackWeeks,
        timeline: s.timeline.map((e) => ({
          phaseNumber: e.phase.phase_number, start: e.start, end: e.end, weeks: e.weeks,
          status: e.progress.status, projected: e.projected, extensionWeeks: e.progress.extension_weeks,
        })),
      },
    });
  } catch (err) {
    console.error('season status failed:', err);
    return NextResponse.json({ error: 'Could not read the season status' }, { status: 500 });
  }
}
