/**
 * Chat session list + create.
 *
 * GET   → recent active sessions for the caller, lightweight.
 * POST  → create a new session, optionally with a seed title.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabase
    .from('coach_chat_sessions')
    .select('id, title, message_count, created_at, updated_at')
    .eq('user_id', auth.userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  let body: { title?: string } = {};
  try { body = await request.json(); } catch {}
  const { data, error } = await supabase
    .from('coach_chat_sessions')
    .insert({ user_id: auth.userId, title: body.title?.slice(0, 200) || null })
    .select('id, title, created_at, updated_at, message_count')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'insert failed' }, { status: 500 });
  return NextResponse.json({ session: data });
}
