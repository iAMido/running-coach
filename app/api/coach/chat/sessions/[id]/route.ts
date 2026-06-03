/**
 * GET    /sessions/[id]         → session metadata + messages
 * DELETE /sessions/[id]         → soft-archive
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const [{ data: session }, { data: messages }] = await Promise.all([
    supabase
      .from('coach_chat_sessions')
      .select('id, title, message_count, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', auth.userId)
      .maybeSingle(),
    supabase
      .from('coach_chat_messages')
      .select('id, role, content, supervisor, created_at')
      .eq('session_id', id)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: true }),
  ]);

  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ session, messages: messages || [] });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const { error } = await supabase
    .from('coach_chat_sessions')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
