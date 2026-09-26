/**
 * GET the methodology books the coaches search: every coaching_books row
 * with its section count, description and where it came from.
 */

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [{ data: books, error }, { data: counts }] = await Promise.all([
    supabase.from('coaching_books').select('id, title, author, methodology, level, tags, phases, focus_areas, raw_metadata, created_at').order('created_at', { ascending: true }),
    supabase.rpc('book_section_counts'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byBook = new Map(((counts ?? []) as { book_id: string; sections: number }[]).map((c) => [c.book_id, Number(c.sections)]));
  return NextResponse.json({
    books: (books ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      methodology: b.methodology,
      level: b.level,
      tags: b.tags ?? [],
      phases: b.phases ?? [],
      focusAreas: b.focus_areas ?? [],
      description: (b.raw_metadata as { description?: string } | null)?.description ?? null,
      uploaded: (b.raw_metadata as { source?: string } | null)?.source === 'library_upload',
      sections: byBook.get(b.id) ?? 0,
      addedAt: b.created_at,
    })),
  });
}
