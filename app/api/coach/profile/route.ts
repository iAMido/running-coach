import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { profileSchema, validateInput } from '@/lib/validation/schemas';

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

    // Validate input
    const validation = validateInput(profileSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('athlete_profile')
      .upsert({
        user_id: userId,
        name: validation.data.name,
        age: validation.data.age,
        weight_kg: validation.data.weight_kg,
        resting_hr: validation.data.resting_hr,
        max_hr: validation.data.max_hr,
        lactate_threshold_hr: validation.data.lactate_threshold_hr,
        current_goal: validation.data.current_goal,
        training_days: validation.data.training_days,
        injury_history: validation.data.injury_history,
        hr_zone_z1: validation.data.hr_zone_z1,
        hr_zone_z2: validation.data.hr_zone_z2,
        hr_zone_z3: validation.data.hr_zone_z3,
        hr_zone_z4: validation.data.hr_zone_z4,
        hr_zone_z5: validation.data.hr_zone_z5,
        hr_zone_z6: validation.data.hr_zone_z6,
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
