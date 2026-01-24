import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, formatWeekDateRange } from '@/lib/utils/week-calculator';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planSaveSchema, validateInput } from '@/lib/validation/schemas';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

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
    if (data) {
      // Use start_date if available, otherwise fallback to created_at
      const startDate = data.start_date || (data.created_at ? data.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
      const weekInfo = calculateCurrentWeek(startDate, data.duration_weeks);

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
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    const body = await request.json();

    // Validate input
    const validation = validateInput(planSaveSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

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
        plan_type: validation.data.plan_type,
        plan_json: validation.data.plan_json,
        duration_weeks: validation.data.duration_weeks,
        start_date: validation.data.start_date || new Date().toISOString().split('T')[0],
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
