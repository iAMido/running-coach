import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildCoachSystemPrompt, buildPlanGenerationPrompt } from '@/lib/ai/coach-prompts';
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

    // Get athlete profile for context
    const { data: profile } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Build prompts
    const systemPrompt = buildCoachSystemPrompt({ profile });
    const userPrompt = buildPlanGenerationPrompt({
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
        { role: 'user', content: userPrompt },
      ],
      { apiKey, maxTokens: 8000 }
    );

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Try to parse JSON from response
    let planJson;
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        planJson = JSON.parse(jsonMatch[0]);
      } else {
        planJson = { raw_response: response.content };
      }
    } catch {
      planJson = { raw_response: response.content };
    }

    // Save to database
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

    return NextResponse.json({ plan, rawResponse: response.content });
  } catch (error) {
    console.error('Error generating plan:', error);
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 });
  }
}
