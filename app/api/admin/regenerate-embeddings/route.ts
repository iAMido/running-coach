import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { generateEmbedding, formatEmbeddingForStorage, countTokens } from '@/lib/rag/embeddings';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

/**
 * Regenerate embeddings for book instructions that don't have them
 * POST /api/admin/regenerate-embeddings
 * Body: { bookId?: string } - optional, if not provided, regenerates for all books
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { bookId } = body;

    // Find instructions without embeddings
    let query = supabase
      .from('book_instructions')
      .select('id, content, section_title')
      .is('embedding', null);

    if (bookId) {
      query = query.eq('book_id', bookId);
    }

    const { data: instructions, error: fetchError } = await query;

    if (fetchError) {
      throw fetchError;
    }

    if (!instructions || instructions.length === 0) {
      return NextResponse.json({
        message: 'No instructions need embeddings',
        processed: 0
      });
    }

    const results = {
      processed: 0,
      errors: [] as string[],
    };

    // Process each instruction
    for (const instruction of instructions) {
      const textToEmbed = `${instruction.section_title || ''}\n\n${instruction.content}`;

      const embeddingResult = await generateEmbedding(textToEmbed);

      if (embeddingResult.error || embeddingResult.embedding.length === 0) {
        results.errors.push(`ID ${instruction.id}: ${embeddingResult.error || 'Empty embedding'}`);
        continue;
      }

      // Update the instruction with the embedding
      const { error: updateError } = await supabase
        .from('book_instructions')
        .update({
          embedding: formatEmbeddingForStorage(embeddingResult.embedding),
          token_count: countTokens(textToEmbed),
        })
        .eq('id', instruction.id);

      if (updateError) {
        results.errors.push(`ID ${instruction.id}: ${updateError.message}`);
      } else {
        results.processed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return NextResponse.json({
      message: `Processed ${results.processed} of ${instructions.length} instructions`,
      processed: results.processed,
      total: instructions.length,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });

  } catch (error) {
    console.error('Error regenerating embeddings:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate embeddings' },
      { status: 500 }
    );
  }
}
