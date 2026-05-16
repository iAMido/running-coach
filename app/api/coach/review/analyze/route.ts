export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedWeeklyAnalysisPrompt, buildEnhancedCoachSystemPrompt } from '@/lib/ai/coach-prompts';
import { buildContext } from '@/lib/rag/context-builder';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { reviewAnalysisSchema, validateInput } from '@/lib/validation/schemas';

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
    const validation = validateInput(reviewAnalysisSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { overallFeeling, sleepQuality, stressLevel, injuryNotes, achievements } = validation.data;

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

    // Fetch laps for this week's runs
    const runIds = (runs || []).map((r: { id: string }) => r.id);
    const { data: laps } = runIds.length > 0
      ? await supabase.from('laps').select('*').in('run_id', runIds).order('lap_number', { ascending: true })
      : { data: [] };

    // Attach laps to each run
    const runsWithLaps = (runs || []).map((run: { id: string }) => ({
      ...run,
      laps: (laps || []).filter((l: { run_id: string }) => l.run_id === run.id),
    }));

    // Build 3-layer RAG context
    const context = await buildContext(
      userId,
      'weekly review analysis',
      'plan_review'
    );

    // Build prompts using enhanced system
    const systemPrompt = buildEnhancedCoachSystemPrompt(context);
    const userPrompt = buildEnhancedWeeklyAnalysisPrompt(context, {
      runs: runsWithLaps,
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
