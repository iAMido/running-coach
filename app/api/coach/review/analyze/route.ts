import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildCoachSystemPrompt, buildWeeklyAnalysisPrompt } from '@/lib/ai/coach-prompts';
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
    const { overallFeeling, sleepQuality, stressLevel, injuryNotes, achievements } = body;

    // Get athlete profile
    const { data: profile } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get this week's runs
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const { data: runs } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', monday.toISOString())
      .order('date', { ascending: true });

    // Get feedback for this week's runs
    const { data: feedback } = await supabase
      .from('run_feedback')
      .select('*')
      .eq('user_id', userId)
      .gte('run_date', monday.toISOString().split('T')[0]);

    // Build prompts
    const systemPrompt = buildCoachSystemPrompt({ profile });
    const userPrompt = buildWeeklyAnalysisPrompt({
      runs: runs || [],
      feedback: feedback || [],
      overallFeeling,
      sleepQuality,
      stressLevel,
      injuryNotes,
      achievements,
    });

    // Call OpenRouter
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { apiKey, maxTokens: 2000 }
    );

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Save the analysis
    const weekStart = monday.toISOString().split('T')[0];

    await supabase
      .from('weekly_summaries')
      .upsert({
        user_id: userId,
        week_start: weekStart,
        overall_feeling: overallFeeling,
        sleep_quality: sleepQuality,
        stress_level: stressLevel,
        injury_notes: injuryNotes,
        achievements,
        ai_analysis: response.content,
      }, { onConflict: 'user_id,week_start' });

    return NextResponse.json({ analysis: response.content });
  } catch (error) {
    console.error('Error analyzing week:', error);
    return NextResponse.json({ error: 'Failed to analyze week' }, { status: 500 });
  }
}
