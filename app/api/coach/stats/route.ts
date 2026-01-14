import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';

// Default user for development when auth is not configured
const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET() {
  const session = await getServerSession();

  // In development, allow access without auth
  const isDev = process.env.NODE_ENV === 'development';
  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

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

    // Get this week's stats (Monday to now)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const { data: weekData } = await supabase
      .from('runs')
      .select('distance_km')
      .eq('user_id', userId)
      .gte('date', monday.toISOString());

    const thisWeekKm = (weekData || []).reduce(
      (sum, run) => sum + (run.distance_km || 0), 0
    );
    const thisWeekRuns = weekData?.length || 0;

    // Get active plan
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      totalRuns: totalRuns || 0,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      thisWeekKm: Math.round(thisWeekKm * 10) / 10,
      thisWeekRuns,
      activePlan: activePlan || null,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
