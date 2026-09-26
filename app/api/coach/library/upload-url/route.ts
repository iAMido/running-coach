/**
 * POST { filename, size } → a signed URL the browser uploads the book PDF to,
 * straight into Storage. Books are 6-11 MB and Vercel rejects request bodies
 * over ~4.5 MB, so the file must never pass through a function.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { BUCKET, MAX_BOOK_BYTES, userFolder } from '@/lib/library/ingest';

const schema = z.object({
  filename: z.string().min(1).max(300),
  size: z.number().int().positive().max(MAX_BOOK_BYTES),
});

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A PDF up to 50 MB is required.' }, { status: 400 });
  }
  if (!/\.pdf$/i.test(parsed.data.filename)) return NextResponse.json({ error: 'Only PDF books are supported.' }, { status: 400 });

  const path = `${userFolder(auth.userId)}/${randomUUID()}.pdf`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `Could not prepare the upload: ${error?.message}` }, { status: 500 });
  return NextResponse.json({ path, signedUrl: data.signedUrl });
}
