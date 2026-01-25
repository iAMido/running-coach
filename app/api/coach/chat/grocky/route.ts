import { NextRequest, NextResponse } from 'next/server';
import { callOpenRouter } from '@/lib/ai/openrouter';
import {
  buildEnhancedGrockySystemPrompt,
  buildEnhancedGrockyPlanReviewPrompt,
  buildEnhancedGrockyChatPrompt,
} from '@/lib/ai/grocky-prompts';
import { buildContext, getContextStats } from '@/lib/rag/context-builder';
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

    const { messages, reviewPlan } = validation.data;

    // Get the user's query from the last message
    const lastUserMessage = messages?.filter((m: ChatMessage) => m.role === 'user').pop();
    const query = lastUserMessage?.content || 'training plan review';

    // Build 3-layer context for Grocky (uses 'grocky' query type)
    const context = await buildContext(userId, query, 'grocky');

    let systemPrompt: string;

    if (reviewPlan) {
      // Plan review mode - use enhanced plan review prompt
      systemPrompt = buildEnhancedGrockyPlanReviewPrompt(context);
    } else if (messages && messages.length > 0) {
      // Chat mode - use enhanced chat prompt
      systemPrompt = buildEnhancedGrockyChatPrompt(context, query);
    } else {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Build messages array - for Grocky, the system prompt includes the user question
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: reviewPlan ? 'Please review my training plan' : query },
    ];

    // Call OpenRouter with Grok model
    const response = await callOpenRouter(apiMessages, {
      apiKey,
      model: 'x-ai/grok-4',
      maxTokens: reviewPlan ? 2500 : 1500
    });

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
        queryType: 'grocky',
        fatigueScore: context.userContext.metadata.fatigueScore,
        currentPhase: context.userContext.metadata.currentPhase,
        contextStats: stats,
      },
    });
  } catch (error) {
    console.error('Error in Grocky chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
