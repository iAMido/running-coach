import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, getSundayOfWeek } from '@/lib/utils/week-calculator';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    // Get total runs count
    const { count: totalRuns } = await supabase
      .from('runs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get total distance
    const { data: distanceData } = await supabase
      .from('runs')
      .select('distance_km')
      .eq('user_id', userId);

    const totalDistanceKm = (distanceData || []).reduce(
      (sum, run) => sum + (run.distance_km || 0), 0
    );

    // Get this week's stats (Sunday to now - week starts on Sunday)
    const now = new Date();
    const sunday = getSundayOfWeek(now);

    const { data: weekData } = await supabase
      .from('runs')
      .select('distance_km')
      .eq('user_id', userId)
      .gte('date', sunday.toISOString());

    const thisWeekKm = (weekData || []).reduce(
      (sum, run) => sum + (run.distance_km || 0), 0
    );
    const thisWeekRuns = weekData?.length || 0;

    // Get active plan with calculated current week
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

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
