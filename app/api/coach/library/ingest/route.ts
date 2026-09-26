/**
 * Book upload A to Z. See lib/library/ingest.ts.
 *
 *   POST { path, filename } → start processing an uploaded PDF (runs stage 1)
 *   POST { ingestId }       → run the next stage
 *   GET  ?id=<ingestId>     → one upload's progress
 *   GET                     → the athlete's unfinished upload, if any (resume)
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { advanceIngest, createIngest, getIngest, INGEST_LABELS, latestOpenIngest, userFolder, type IngestRow } from '@/lib/library/ingest';

function view(row: IngestRow, busy = false) {
  return {
    id: row.id,
    stage: row.stage,
    label: INGEST_LABELS[row.stage],
    busy,
    filename: row.filename,
    pages: row.pages,
    meta: row.meta,
    chunksTotal: row.chunks_total,
    chunksDone: row.chunks_done,
    check: row.check_result,
    error: row.error,
  };
}

const startSchema = z.object({ path: z.string().min(1).max(300), filename: z.string().min(1).max(300) });
const nextSchema = z.object({ ingestId: z.string().uuid() });

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  const row = id ? await getIngest(auth.userId, id) : await latestOpenIngest(auth.userId);
  return NextResponse.json({ ingest: row ? view(row) : null });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const next = nextSchema.safeParse(body);
    if (next.success) {
      const { row, busy } = await advanceIngest(auth.userId, next.data.ingestId);
      return NextResponse.json({ ingest: view(row, busy) });
    }
    const start = startSchema.safeParse(body);
    if (!start.success) return NextResponse.json({ error: 'path and filename are required' }, { status: 400 });
    // Only a file in this athlete's own upload folder.
    if (!start.data.path.startsWith(`${userFolder(auth.userId)}/`)) {
      return NextResponse.json({ error: 'That upload does not belong to you.' }, { status: 403 });
    }
    const created = await createIngest(auth.userId, start.data.filename, start.data.path);
    const { row, busy } = await advanceIngest(auth.userId, created.id);
    return NextResponse.json({ ingest: view(row, busy) });
  } catch (err) {
    console.error('library ingest failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
