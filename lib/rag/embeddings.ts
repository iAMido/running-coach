/**
 * Embedding generation for RAG system
 * Uses OpenAI's text-embedding-3-small model for 1536-dimensional vectors
 */

const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingResponse {
  embedding: number[];
  tokenCount: number;
  error?: string;
}

interface BatchEmbeddingResponse {
  embeddings: { text: string; embedding: number[]; tokenCount: number }[];
  error?: string;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResponse> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      embedding: [],
      tokenCount: 0,
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
    };
  }

  // Clean and truncate text if needed (max ~8000 tokens for embedding model)
  const cleanedText = cleanTextForEmbedding(text);

  try {
    const response = await fetch(OPENAI_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: cleanedText,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `API error: ${response.status}`;
      return { embedding: [], tokenCount: 0, error: errorMessage };
    }

    const data = await response.json();

    if (data.error) {
      return { embedding: [], tokenCount: 0, error: data.error.message };
    }

    return {
      embedding: data.data[0].embedding,
      tokenCount: data.usage?.total_tokens || estimateTokenCount(cleanedText),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { embedding: [], tokenCount: 0, error: `Failed to generate embedding: ${message}` };
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * OpenAI supports up to 2048 inputs per request
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  batchSize: number = 100
): Promise<BatchEmbeddingResponse> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      embeddings: [],
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
    };
  }

  const results: { text: string; embedding: number[]; tokenCount: number }[] = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const cleanedBatch = batch.map(cleanTextForEmbedding);

    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: cleanedBatch,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `API error: ${response.status}`;
        return { embeddings: results, error: errorMessage };
      }

      const data = await response.json();

      if (data.error) {
        return { embeddings: results, error: data.error.message };
      }

      // Match embeddings back to original texts
      for (let j = 0; j < data.data.length; j++) {
        results.push({
          text: batch[j],
          embedding: data.data[j].embedding,
          tokenCount: Math.ceil((data.usage?.total_tokens || 0) / batch.length),
        });
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { embeddings: results, error: `Failed to generate batch embeddings: ${message}` };
    }
  }

  return { embeddings: results };
}

/**
 * Clean text for embedding generation
 * - Remove excessive whitespace
 * - Truncate to reasonable length
 * - Remove special characters that might cause issues
 */
function cleanTextForEmbedding(text: string): string {
  // Remove excessive whitespace
  let cleaned = text.replace(/\s+/g, ' ').trim();

  // Truncate to ~6000 words (roughly 8000 tokens)
  const words = cleaned.split(' ');
  if (words.length > 6000) {
    cleaned = words.slice(0, 6000).join(' ');
  }

  return cleaned;
}

/**
 * Estimate token count for a text
 * Rough approximation: 1 token ~= 4 characters for English text
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens more accurately using a simple word-based approximation
 * Average: 1 token ~= 0.75 words for English text
 */
export function countTokens(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return Math.ceil(words.length / 0.75);
}

/**
 * Format embedding for Supabase storage
 * pgvector expects a string format like '[0.1, 0.2, ...]'
 */
export function formatEmbeddingForStorage(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Parse embedding from Supabase storage
 */
export function parseEmbeddingFromStorage(stored: string): number[] {
  const cleaned = stored.replace(/[\[\]]/g, '');
  return cleaned.split(',').map(Number);
}

export { EMBEDDING_DIMENSIONS };
