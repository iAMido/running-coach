import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildCoachSystemPrompt } from '@/lib/ai/coach-prompts';
import type { ChatMessage } from '@/lib/db/types';

const DEV_USER_ID = 'idomosseri@gmail.com';

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  const isDev = process.env.NODE_ENV === 'development';

  if (!session?.user?.email && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session?.user?.email || DEV_USER_ID;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { messages } = body as { messages: ChatMessage[] };

    // Get athlete profile and recent runs for context
    const { data: profile } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);

    const { data: recentRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())
      .order('date', { ascending: false })
      .limit(10);

    // Get active plan
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    // Build system prompt with context
    let systemPrompt = buildCoachSystemPrompt({ profile, recentRuns: recentRuns || undefined, activePlan });

    // Add recent training context
    if (recentRuns && recentRuns.length > 0) {
      systemPrompt += `\n\n## RECENT TRAINING (Last 14 days)\n${JSON.stringify(recentRuns, null, 2)}`;
    }

    if (activePlan) {
      systemPrompt += `\n\n## CURRENT TRAINING PLAN\n${JSON.stringify(activePlan.plan_json, null, 2)}`;
    }

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

    return NextResponse.json({ content: response.content });
  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
