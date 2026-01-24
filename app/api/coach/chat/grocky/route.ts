import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildGrockySystemPrompt, buildPlanReviewPrompt, buildGrockyChatContext } from '@/lib/ai/grocky-prompts';
import type { ChatMessage } from '@/lib/db/types';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

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
    const { messages, reviewPlan } = body as { messages?: ChatMessage[]; reviewPlan?: boolean };

    // Get athlete profile
    const { data: profile } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent runs
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);

    const { data: recentRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())
      .order('date', { ascending: false });

    // Get active plan
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    const systemPrompt = buildGrockySystemPrompt({ profile, currentPlan: activePlan, recentRuns: recentRuns || undefined });

    let userPrompt: string;

    if (reviewPlan) {
      // Plan review mode
      userPrompt = buildPlanReviewPrompt({
        plan: activePlan?.plan_json || null,
        recentRuns: recentRuns || [],
      });
    } else if (messages && messages.length > 0) {
      // Chat mode - use the last user message
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      userPrompt = buildGrockyChatContext(lastUserMessage?.content || '', {
        profile,
        currentPlan: activePlan,
        recentRuns: recentRuns || undefined
      });
    } else {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Build messages array
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
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

    return NextResponse.json({ content: response.content });
  } catch (error) {
    console.error('Error in Grocky chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
