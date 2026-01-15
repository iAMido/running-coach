import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';

const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;
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
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;

  try {
    const body = await request.json();

    const { data, error } = await supabase
      .from('run_feedback')
      .insert({
        user_id: userId,
        run_date: body.run_date,
        rating: body.rating,
        effort_level: body.effort_level,
        feeling: body.feeling,
        comment: body.comment,
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
