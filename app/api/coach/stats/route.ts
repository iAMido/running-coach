import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, getSundayOfWeek } from '@/lib/utils/week-calculator';
import { nowInUserTz } from '@/lib/utils/user-time';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    // Week boundary (Sunday, user timezone — server is UTC)
    const now = nowInUserTz();
    const sunday = getSundayOfWeek(now);

    // All three fetches are independent — run together. Lifetime totals
    // come from a Postgres aggregate RPC (runcoach.run_totals): the route
    // previously pulled EVERY runs row to sum distance in JS, a payload
    // that grew forever with training history.
    const [totalsRes, weekRes, planRes] = await Promise.all([
      supabase.rpc('run_totals', { p_user_id: userId }),
      supabase
        .from('runs')
        .select('distance_km')
        .eq('user_id', userId)
        .gte('date', sunday.toISOString()),
      supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const totalsRow = (totalsRes.data as { total_runs: number; total_km: number }[] | null)?.[0];
    const totalRuns = Number(totalsRow?.total_runs ?? 0);
    const totalDistanceKm = Number(totalsRow?.total_km ?? 0);

    const weekData = weekRes.data;
    const thisWeekKm = (weekData || []).reduce(
      (sum, run) => sum + (run.distance_km || 0), 0
    );
    const thisWeekRuns = weekData?.length || 0;

    const activePlan = planRes.data;

    // Calculate current week for the active plan
    let planWithWeekInfo = activePlan;
    if (activePlan) {
      // Use start_date if available, otherwise fallback to created_at
      const startDate = activePlan.start_date || (activePlan.created_at ? activePlan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
      const weekInfo = calculateCurrentWeek(startDate, activePlan.duration_weeks);
      planWithWeekInfo = {
        ...activePlan,
        current_week_num: weekInfo.currentWeek,
        isAfterEnd: weekInfo.isAfterEnd,
      };
    }

    return NextResponse.json({
      totalRuns: totalRuns || 0,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      thisWeekKm: Math.round(thisWeekKm * 10) / 10,
      thisWeekRuns,
      activePlan: planWithWeekInfo || null,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
