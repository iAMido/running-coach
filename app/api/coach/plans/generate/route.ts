import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedPlanGenerationPrompt } from '@/lib/ai/coach-prompts';
import { buildContext, getContextStats } from '@/lib/rag/context-builder';
import { getAthleteProfile } from '@/lib/db/profile';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planGenerationSchema, validateInput } from '@/lib/validation/schemas';

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
    const validation = validateInput(planGenerationSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { planType, durationWeeks, runsPerWeek, targetRace, notes } = validation.data;

    // Get athlete profile for training days
    const profile = await getAthleteProfile(userId);

    // Build a query string for context retrieval
    const contextQuery = `Create a ${durationWeeks}-week ${planType} training plan for ${targetRace || 'general fitness'}`;

    // Build 3-layer context (uses 'plan_generation' which is 35% user / 10% coach / 55% books)
    const context = await buildContext(userId, contextQuery, 'plan_generation');

    // Build enhanced plan generation prompt with 3-layer context
    const systemPrompt = buildEnhancedPlanGenerationPrompt(context, {
      planType,
      durationWeeks,
      runsPerWeek,
      targetRace,
      notes,
      trainingDays: profile?.training_days,
    });

    // Call OpenRouter
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate my ${durationWeeks}-week ${planType} training plan. IMPORTANT: Return ONLY the raw JSON object with no markdown code blocks, no explanation, no extra text — just the JSON.` },
      ],
      { apiKey, maxTokens: 16000 }
    );

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Try to parse JSON from response
    let planJson;
    try {
      // First: try to extract JSON from a markdown code block (```json ... ```)
      const codeBlockMatch = response.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        planJson = JSON.parse(codeBlockMatch[1]);
      } else {
        // Second: try to find the outermost JSON object (from first { to last })
        const firstBrace = response.content.indexOf('{');
        const lastBrace = response.content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          planJson = JSON.parse(response.content.slice(firstBrace, lastBrace + 1));
        } else {
          planJson = { raw_response: response.content };
        }
      }
    } catch {
      planJson = { raw_response: response.content };
    }

    // Save to database - mark existing active plans as completed
    await supabase
      .from('training_plans')
      .update({ status: 'completed' })
      .eq('user_id', userId)
      .eq('status', 'active');

    const { data: plan, error } = await supabase
      .from('training_plans')
      .insert({
        user_id: userId,
        plan_type: planType,
        plan_json: planJson,
        duration_weeks: durationWeeks,
        start_date: new Date().toISOString().split('T')[0],
        current_week_num: 1,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    // Get context stats for debugging/monitoring
    const stats = getContextStats(context);

    return NextResponse.json({
      plan,
      rawResponse: response.content,
      sources: {
        books: context.bookContext.sources,
        coachWorkouts: context.coachContext.workoutsIncluded,
      },
      metadata: {
        queryType: 'plan_generation',
        contextStats: stats,
      },
    });
  } catch (error) {
    console.error('Error generating plan:', error);
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 });
  }
}
