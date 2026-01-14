import { NextRequest, NextResponse } from 'next/server';
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
  const session = await getServerSession();

  // In development, allow access without auth
  const isDev = process.env.NODE_ENV === 'development';
  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

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
