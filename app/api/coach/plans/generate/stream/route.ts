/**
 * Streaming variant of plan generation.
 *
 * The non-streaming version is fine but means the user stares at a spinner
 * for 30-60s while Claude assembles a multi-week plan. This route pipes
 * the model's tokens back over Server-Sent Events so the page can show
 * progress live.
 *
 * Event types emitted:
 *   - `meta`   {{ contextStats, sources }}      once, before tokens
 *   - `token`  raw text chunks                  many
 *   - `done`   {{ plan, callId, supervisor }}   once, at the end
 *   - `error`  {{ message }}                    on failure
 *
 * Final parse + DB write + supervisor logging happen here on the server
 * after streaming completes, so the client doesn't need to know about JSON
 * extraction. The streamed text is purely for UX.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { streamOpenRouter, callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedPlanGenerationPrompt } from '@/lib/ai/coach-prompts';
import { buildContext, getContextStats } from '@/lib/rag/context-builder';
import { getAthleteProfile } from '@/lib/db/profile';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planGenerationSchema, validateInput } from '@/lib/validation/schemas';
import {
  validateContext as supervisorValidate,
  serializeWarnings,
  logCoachCall,
  runCritic,
} from '@/lib/supervisor';
import { TOKEN_BUDGETS_PER_QUERY } from '@/lib/rag/types';
import { MODEL_FOR } from '@/lib/ai/model-registry';

void callOpenRouter; // streaming-only, but referenced via openrouter types

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return new Response(JSON.stringify({ error: auth.error || 'Unauthorized' }), { status: 401 });
  }

  const userId = auth.userId;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const validation = validateInput(planGenerationSchema, body);
  if (!validation.success) {
    return new Response(JSON.stringify({ error: validation.error }), { status: 400 });
  }

  const { planType, durationWeeks, runsPerWeek, targetRace, notes } = validation.data;
  const profile = await getAthleteProfile(userId);

  const contextQuery = `Create a ${durationWeeks}-week ${planType} training plan for ${targetRace || 'general fitness'}`;
  const context = await buildContext(userId, contextQuery, 'plan_generation');

  const preflight = supervisorValidate({ context, queryType: 'plan_generation' });

  let systemPrompt = buildEnhancedPlanGenerationPrompt(context, {
    planType,
    durationWeeks,
    runsPerWeek,
    targetRace,
    notes,
    trainingDays: profile?.training_days,
  });
  if (preflight.augmentedSystemSuffix) {
    systemPrompt = systemPrompt + preflight.augmentedSystemSuffix;
  }

  const stats = getContextStats(context);

  const encoder = new TextEncoder();
  let fullText = '';
  const callStart = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));

      emit('meta', {
        contextStats: stats,
        sources: {
          books: context.bookContext.sources,
          coachWorkouts: context.coachContext.workoutsIncluded,
        },
        supervisor: { preflightOk: preflight.ok, warnings: preflight.warnings },
      });

      try {
        const generator = streamOpenRouter(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate my ${durationWeeks}-week ${planType} training plan. IMPORTANT: Return ONLY the raw JSON object with no markdown code blocks, no explanation, no extra text — just the JSON.` },
          ],
          { apiKey, model: MODEL_FOR.plan_generation, maxTokens: 16000 },
        );

        for await (const chunk of generator) {
          fullText += chunk;
          emit('token', { text: chunk });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream failed';
        emit('error', { message: msg });
        controller.close();
        return;
      }

      const latencyMs = Date.now() - callStart;

      // Parse the assembled JSON
      let planJson: Record<string, unknown>;
      try {
        const codeBlockMatch = fullText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          planJson = JSON.parse(codeBlockMatch[1]);
        } else {
          const first = fullText.indexOf('{');
          const last = fullText.lastIndexOf('}');
          if (first !== -1 && last > first) {
            planJson = JSON.parse(fullText.slice(first, last + 1));
          } else {
            planJson = { raw_response: fullText };
          }
        }
      } catch {
        planJson = { raw_response: fullText };
      }

      // Save: deactivate previous, insert new
      await supabase
        .from('training_plans')
        .update({ status: 'completed' })
        .eq('user_id', userId)
        .eq('status', 'active');

      const { data: plan, error: dbError } = await supabase
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

      if (dbError) {
        emit('error', { message: dbError.message });
        controller.close();
        return;
      }

      const callId = await logCoachCall({
        user_id: userId,
        route: '/api/coach/plans/generate/stream',
        query_type: 'plan_generation',
        model: MODEL_FOR.plan_generation,
        context_tokens: context.totalTokens,
        context_budget: TOKEN_BUDGETS_PER_QUERY.plan_generation,
        ceiling_hit: context.totalTokens >= TOKEN_BUDGETS_PER_QUERY.plan_generation * 0.95,
        cache_used: false,
        preflight_ok: preflight.ok,
        preflight_warnings: serializeWarnings(preflight.warnings),
        preflight_augmented: !!preflight.augmentedSystemSuffix,
        latency_ms: latencyMs,
        status: 'ok',
        error_message: null,
        plan_modified: false,
      });

      if (callId) {
        runCritic({
          userId,
          callId,
          route: '/api/coach/plans/generate/stream',
          queryType: 'plan_generation',
          userQuery: `Generate ${durationWeeks}-week ${planType} plan (target: ${targetRace || 'general fitness'})`,
          coachResponse: fullText,
          contextSummary: `book_sources=${context.bookContext.sources.length} coach_workouts=${context.coachContext.workoutsIncluded.length} duration_weeks=${durationWeeks}`,
          preflightWarnings: preflight.warnings,
        }).catch(err => console.warn('critic failed:', err?.message));
      }

      emit('done', {
        plan,
        callId,
        supervisor: { preflightOk: preflight.ok, warnings: preflight.warnings },
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
