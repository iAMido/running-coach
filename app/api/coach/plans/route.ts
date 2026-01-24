import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, formatWeekDateRange } from '@/lib/utils/week-calculator';

const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET() {
  const session = await getServerSession();

  const isDev = process.env.NODE_ENV === 'development';
  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

  try {
    const { data, error } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    // If we have a plan, calculate the current week dynamically
    if (data && data.start_date) {
      const weekInfo = calculateCurrentWeek(data.start_date, data.duration_weeks);

      // Return plan with calculated current week
      return NextResponse.json({
        plan: {
          ...data,
          current_week_num: weekInfo.currentWeek,
          // Additional info for the UI
          week_info: {
            currentWeek: weekInfo.currentWeek,
            isBeforeStart: weekInfo.isBeforeStart,
            isAfterEnd: weekInfo.isAfterEnd,
            weekStartDate: weekInfo.weekStartDate.toISOString(),
            weekEndDate: weekInfo.weekEndDate.toISOString(),
            planStartDate: weekInfo.planStartDate.toISOString(),
            planEndDate: weekInfo.planEndDate.toISOString(),
            weekDateRange: formatWeekDateRange(weekInfo.weekStartDate, weekInfo.weekEndDate),
            daysIntoWeek: weekInfo.daysIntoWeek,
            daysRemaining: weekInfo.daysRemaining,
          }
        }
      });
    }

    return NextResponse.json({ plan: data || null });
  } catch (error) {
    console.error('Error fetching plan:', error);
    return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  const isDev = process.env.NODE_ENV === 'development';
  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

  try {
    const body = await request.json();

    // Deactivate existing plans
    await supabase
      .from('training_plans')
      .update({ status: 'completed' })
      .eq('user_id', userId)
      .eq('status', 'active');

    // Create new plan
    const { data, error } = await supabase
      .from('training_plans')
      .insert({
        user_id: userId,
        plan_type: body.plan_type,
        plan_json: body.plan_json,
        duration_weeks: body.duration_weeks,
        start_date: body.start_date || new Date().toISOString().split('T')[0],
        current_week_num: 1,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ plan: data });
  } catch (error) {
    console.error('Error creating plan:', error);
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}
