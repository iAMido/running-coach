/**
 * Edit one training race / event (fill a coach slot, move it, mark it
 * skipped), or remove it.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { deleteEvent, updateEvent } from '@/lib/db/season-events';
import { seasonEventSchema, validateInput } from '@/lib/validation/schemas';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const v = validateInput(seasonEventSchema, await request.json().catch(() => ({})));
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const event = await updateEvent(auth.userId, id, v.data);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not update the event' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const ok = await deleteEvent(auth.userId, id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Event not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete the event' }, { status: 500 });
  }
}
