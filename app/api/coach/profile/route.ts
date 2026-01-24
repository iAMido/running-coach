import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    const { data, error } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return NextResponse.json({ profile: data || null });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    const body = await request.json();

    const { data, error } = await supabase
      .from('athlete_profile')
      .upsert({
        user_id: userId,
        name: body.name,
        age: body.age,
        weight_kg: body.weight_kg,
        resting_hr: body.resting_hr,
        max_hr: body.max_hr,
        lactate_threshold_hr: body.lactate_threshold_hr,
        current_goal: body.current_goal,
        training_days: body.training_days,
        injury_history: body.injury_history,
        hr_zone_z1: body.hr_zone_z1,
        hr_zone_z2: body.hr_zone_z2,
        hr_zone_z3: body.hr_zone_z3,
        hr_zone_z4: body.hr_zone_z4,
        hr_zone_z5: body.hr_zone_z5,
        hr_zone_z6: body.hr_zone_z6,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ profile: data });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
