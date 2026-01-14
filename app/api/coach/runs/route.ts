import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';

// Default user for development when auth is not configured
const DEV_USER_ID = 'idomosseri@gmail.com';

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  // In development, allow access without auth
  const isDev = process.env.NODE_ENV === 'development';
  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '14');
  const limit = parseInt(searchParams.get('limit') || '100');

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())
      .order('date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ runs: data || [] });
  } catch (error) {
    console.error('Error fetching runs:', error);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
      .from('runs')
      .insert({ ...body, user_id: userId })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ run: data });
  } catch (error) {
    console.error('Error creating run:', error);
    return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
  }
}
