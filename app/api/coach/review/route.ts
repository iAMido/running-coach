import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { weeklySummarySchema, validateInput } from '@/lib/validation/schemas';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get('week_start');

  try {
    if (weekStart) {
      const { data, error } = await supabase
        .from('weekly_summaries')
        .select('*')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return NextResponse.json({ summary: data || null });
    }

    // Get recent summaries
    const { data, error } = await supabase
      .from('weekly_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
      .limit(8);

    if (error) throw error;

    return NextResponse.json({ summaries: data || [] });
  } catch (error) {
    console.error('Error fetching summaries:', error);
    return NextResponse.json({ error: 'Failed to fetch summaries' }, { status: 500 });
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
    const validation = validateInput(weeklySummarySchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('weekly_summaries')
      .upsert({
        user_id: userId,
        week_start: validation.data.week_start,
        overall_feeling: validation.data.overall_feeling,
        sleep_quality: validation.data.sleep_quality,
        stress_level: validation.data.stress_level,
        injury_notes: validation.data.injury_notes,
        achievements: validation.data.achievements,
        ai_analysis: validation.data.ai_analysis,
      }, { onConflict: 'user_id,week_start' })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ summary: data });
  } catch (error) {
    console.error('Error saving summary:', error);
    return NextResponse.json({ error: 'Failed to save summary' }, { status: 500 });
  }
}
