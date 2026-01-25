import { NextRequest, NextResponse } from 'next/server';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedCoachSystemPrompt } from '@/lib/ai/coach-prompts';
import { buildContext, detectQueryType, getContextStats } from '@/lib/rag/context-builder';
import type { ChatMessage } from '@/lib/db/types';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { chatRequestSchema, validateInput } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate input
    const validation = validateInput(chatRequestSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { messages } = validation.data as { messages: ChatMessage[] };

    // Get the user's query from the last message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const query = lastUserMessage?.content || '';

    // Detect query type and build 3-layer context
    const queryType = detectQueryType(query);
    const context = await buildContext(userId, query, queryType);

    // Build enhanced system prompt with 3-layer hierarchy
    const systemPrompt = buildEnhancedCoachSystemPrompt(context);

    // Build messages array
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Call OpenRouter
    const response = await callOpenRouter(apiMessages, { apiKey, maxTokens: 1500 });

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Get context stats for debugging/monitoring
    const stats = getContextStats(context);

    return NextResponse.json({
      content: response.content,
      sources: {
        books: context.bookContext.sources,
        coachWorkouts: context.coachContext.workoutsIncluded,
      },
      metadata: {
        queryType,
        fatigueScore: context.userContext.metadata.fatigueScore,
        currentPhase: context.userContext.metadata.currentPhase,
        contextStats: stats,
      },
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
