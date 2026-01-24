import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { runFeedbackSchema, validateInput } from '@/lib/validation/schemas';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '14');

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('run_feedback')
      .select('*')
      .eq('user_id', userId)
      .gte('run_date', startDate.toISOString().split('T')[0])
      .order('run_date', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ feedback: data || [] });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
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
    const validation = validateInput(runFeedbackSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('run_feedback')
      .insert({
        user_id: userId,
        run_date: validation.data.run_date,
        rating: validation.data.rating,
        effort_level: validation.data.effort_level,
        feeling: validation.data.feeling,
        comment: validation.data.comment,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ feedback: data });
  } catch (error) {
    console.error('Error creating feedback:', error);
    return NextResponse.json({ error: 'Failed to create feedback' }, { status: 500 });
  }
}
