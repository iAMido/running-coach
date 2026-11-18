/**
 * The season layer: read the active macro plan.
 *
 * Seasons are built by the staged builder (`POST /api/coach/plans/build`
 * with `kind: 'season'`). This route's single-call POST generator was removed
 * on 2026-11-18; nothing in the app called it any more.
 */

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getActiveMacroPlan } from '@/lib/coach/macro-plan';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ macroPlan: await getActiveMacroPlan(auth.userId) });
}
