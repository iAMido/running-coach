import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { getActivePlanView } from '@/lib/coach/dashboard-data';
import { planSaveSchema, validateInput } from '@/lib/validation/schemas';
import { userDateStr } from '@/lib/utils/user-time';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    return NextResponse.json({ plan: await getActivePlanView(userId) });
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
        start_date: validation.data.start_date || userDateStr(),
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
