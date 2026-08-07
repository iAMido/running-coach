export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { COACH_STATIC_BLOCK, buildCoachDynamicBlock } from '@/lib/ai/coach-prompts';
import { buildContext, detectQueryType, getContextStats } from '@/lib/rag/context-builder';
import type { ChatMessage } from '@/lib/db/types';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { chatRequestSchema, validateInput } from '@/lib/validation/schemas';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { getActivePlan } from '@/lib/db/plans';
import {
  validateContext as supervisorValidate,
  serializeWarnings,
  logCoachCall,
  runCritic,
} from '@/lib/supervisor';
import { TOKEN_BUDGETS_PER_QUERY } from '@/lib/rag/types';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { getLatestRecoveryReading } from '@/lib/db/wellness';

// Detect if user wants to modify their training plan
function detectPlanModificationIntent(query: string): boolean {
  const modificationPatterns = [
    /\b(change|modify|adjust|update|swap|move|reduce|increase|skip|cancel|reschedule)\b.*\b(plan|workout|training|run|session|week)/i,
    /\b(plan|workout|training|run|session|week)\b.*\b(change|modify|adjust|update|swap|move|reduce|increase|skip|cancel)/i,
    /\bi('m| am)\s+(injured|sick|tired|busy|traveling)/i,
    /\bcan('t| not)\s+(run|train|make it)/i,
    /\b(too\s+(tired|busy|sore)|need\s+(rest|recovery|less))/i,
    /\b(move|switch|swap)\s+\w+('s)?\s+(run|workout|session)/i,
    /\b(this week|next week|tomorrow)\b.*\b(easier|harder|less|more|off|rest)/i,
    /\bmake\s+(it|my\s+(training|plan|week))\s+(easier|harder|lighter)/i,
    /\breduce\s+(volume|mileage|intensity|training)/i,
    /\badd\s+(more|extra|another)\s+(rest|recovery|easy)/i,
  ];

  return modificationPatterns.some(pattern => pattern.test(query));
}

// Build a prompt that asks the AI to generate structured plan changes
function buildPlanModificationPrompt(
  basePrompt: string,
  currentPlan: unknown,
  currentWeek: number,
  userRequest: string
): string {
  return `${basePrompt}

## PLAN MODIFICATION MODE ACTIVATED

The user wants to modify their training plan. You MUST respond in TWO parts:

### PART 1: Conversational Response
Acknowledge their request and explain what changes you're making and why.

### PART 2: Structured Changes (REQUIRED)
After your conversational response, output the plan changes in this EXACT JSON format wrapped in <plan_changes> tags:

<plan_changes>
{
  "adjustment_summary": "Brief description of changes",
  "recommendations": ["Change 1", "Change 2"],
  "warnings": ["Any concerns - optional"],
  "adjusted_weeks": [
    {
      "week_number": ${currentWeek},
      "phase": "Current phase",
      "focus": "Week focus after adjustment",
      "total_km": 30,
      "workouts": {
        "Sunday": { "type": "...", "duration": "...", "distance": "...", "target_hr": "...", "target_pace": "...", "description": "..." },
        "Monday": { "type": "...", "duration": "...", "distance": "...", "target_hr": "...", "target_pace": "...", "description": "..." }
      }
    }
  ]
}
</plan_changes>

### CURRENT PLAN STATE
${JSON.stringify(currentPlan, null, 2)}

### CURRENT POSITION
Week ${currentWeek} of the plan

### USER'S REQUEST
"${userRequest}"

IMPORTANT:
- You MUST include the <plan_changes> JSON block after your conversational response
- Generate the FULL week's workouts (Sunday through Saturday) for at least the current week
- If changes affect multiple weeks, include all affected weeks
- The week starts on SUNDAY
- Be specific about workout details (paces, HR zones, duration)
`;
}

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

    const { messages, sessionId: incomingSessionId } = validation.data as {
      messages: ChatMessage[];
      sessionId?: string | null;
    };

    // Get the user's query from the last message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const query = lastUserMessage?.content || '';

    // Resolve or create a chat session. The page sends sessionId on
    // continuing conversations; on the very first turn we create one and
    // seed the title from the first user message. Session creation stays
    // synchronous because the response must carry sessionId; message
    // persistence is deferred to after() below — persisting the user
    // message only after the AI succeeds also kills the duplicate-turn bug
    // where a failed call + retry double-inserted the same user message.
    const queryType = detectQueryType(query);
    const isPlanModification = detectPlanModificationIntent(query);

    // One round of parallel fetches for everything independent: the chat
    // session (create if new), the active plan (used by plan-mod, preflight,
    // AND buildContext — previously fetched 3x per request), and the RAG
    // context itself.
    const [chatSessionId, activePlan] = await Promise.all([
      (async (): Promise<string | null> => {
        if (incomingSessionId) return incomingSessionId;
        if (!query) return null;
        const { data: newSession } = await supabase
          .from('coach_chat_sessions')
          .insert({ user_id: userId, title: query.slice(0, 80) })
          .select('id')
          .single();
        return newSession?.id ?? null;
      })(),
      getActivePlan(userId),
    ]);

    const context = await buildContext(userId, query, queryType, { plan: activePlan });

    let currentWeek = 1;
    if (isPlanModification && activePlan) {
      const startDate = activePlan.start_date
        || (activePlan.created_at ? activePlan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
      currentWeek = calculateCurrentWeek(startDate, activePlan.duration_weeks).currentWeek;
    }

    // Dynamic system block: RAG context (+ plan-modification instructions
    // when needed). The static persona/instructions block travels separately
    // as cacheableSystemPrefix so Anthropic's prompt cache actually hits —
    // it's byte-identical across every call.
    let systemPrompt: string;
    if (isPlanModification && activePlan) {
      systemPrompt = buildPlanModificationPrompt(
        buildCoachDynamicBlock(context),
        activePlan.plan_json,
        currentWeek,
        query
      );
    } else {
      systemPrompt = buildCoachDynamicBlock(context);
    }

    // Pre-flight supervisor gate. Reads the assembled context, flags silent
    // gaps (no planned-today workout, no recent runs, etc.), and may inject
    // a short "SUPERVISOR NOTES" block at the end of the system prompt so
    // the model acknowledges gaps instead of confabulating around them.
    // Recovery-feed freshness. Best-effort: if this lookup fails we pass
    // `undefined`, which means "not checked" and raises no warning — better
    // than a false "stale" claim from a transient database error.
    //
    // Measured from the last READING, not the last row. A row exists for today
    // from just after local midnight — the nightly sync writes ctl/atl before
    // the watch has uploaded anything — so asking for the newest row reported
    // the recovery feed as perfectly current every morning while every
    // watch-sourced field in it was null.
    let latestWellnessDay: string | null | undefined;
    try {
      latestWellnessDay = (await getLatestRecoveryReading(userId))?.row.day ?? null;
    } catch {
      latestWellnessDay = undefined;
    }

    const preflight = supervisorValidate({
      context,
      queryType,
      plan: activePlan,
      hasActivePlan: !!activePlan,
      latestWellnessDay,
    });
    if (preflight.augmentedSystemSuffix) {
      systemPrompt = systemPrompt + preflight.augmentedSystemSuffix;
    }

    // Build messages array
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Pick the model from the registry: plan modifications need structured
    // JSON output + accuracy, so they go through Sonnet; everything else
    // through the chat_default model.
    const chatModel = isPlanModification ? MODEL_FOR.plan_modification : MODEL_FOR.chat_default;
    const callStart = Date.now();
    const response = await callOpenRouter(apiMessages, {
      apiKey,
      model: chatModel,
      maxTokens: isPlanModification ? 4000 : 1500,
      cacheableSystemPrefix: COACH_STATIC_BLOCK,
    });
    const callLatencyMs = Date.now() - callStart;

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Get context stats for debugging/monitoring
    const stats = getContextStats(context);

    // If this was a plan modification request, try to parse and apply changes
    let planUpdated = false;
    let adjustmentSummary: string | undefined;

    if (isPlanModification && activePlan && response.content) {
      // Try to extract plan changes from the response
      const planChangesMatch = response.content.match(/<plan_changes>([\s\S]*?)<\/plan_changes>/);

      if (planChangesMatch) {
        try {
          const changesJson = planChangesMatch[1].trim();
          const adjustmentResult = JSON.parse(changesJson);

          if (adjustmentResult.adjusted_weeks && Array.isArray(adjustmentResult.adjusted_weeks)) {
            // Merge adjusted weeks into the existing plan
            const existingWeeks = activePlan.plan_json?.weeks || [];
            const updatedWeeks = [...existingWeeks];

            for (const adjustedWeek of adjustmentResult.adjusted_weeks) {
              const weekIndex = updatedWeeks.findIndex(
                (w: { week_number: number }) => w.week_number === adjustedWeek.week_number
              );
              if (weekIndex !== -1) {
                updatedWeeks[weekIndex] = adjustedWeek;
              } else {
                updatedWeeks.push(adjustedWeek);
              }
            }

            // Sort weeks by week number
            updatedWeeks.sort((a: { week_number: number }, b: { week_number: number }) =>
              a.week_number - b.week_number
            );

            // Update the plan in database
            const updatedPlanJson = {
              ...activePlan.plan_json,
              weeks: updatedWeeks,
              last_adjusted: new Date().toISOString(),
              adjustment_history: [
                ...(activePlan.plan_json?.adjustment_history || []),
                {
                  date: new Date().toISOString(),
                  type: 'chat_request',
                  summary: adjustmentResult.adjustment_summary,
                  from_week: currentWeek,
                }
              ]
            };

            const { error: updateError } = await supabase
              .from('training_plans')
              .update({ plan_json: updatedPlanJson })
              .eq('id', activePlan.id);

            if (!updateError) {
              planUpdated = true;
              adjustmentSummary = adjustmentResult.adjustment_summary;
            }
          }
        } catch (parseError) {
          console.error('Failed to parse plan changes:', parseError);
          // Continue without applying changes - the conversational response is still valuable
        }
      }
    }

    // Clean up the response content (remove the JSON block from display)
    let displayContent = response.content;
    if (planUpdated) {
      // Remove the <plan_changes> block from the displayed response
      displayContent = displayContent.replace(/<plan_changes>[\s\S]*?<\/plan_changes>/, '').trim();

      // Add confirmation to the response
      displayContent += `\n\n✅ **Your training plan has been updated!** The changes are now reflected in your Plan page.`;
    }

    // Everything below is bookkeeping the user shouldn't wait for:
    // telemetry row, Haiku critic, chat persistence. next/server after()
    // schedules it post-response with a platform guarantee it runs — the
    // previous fire-and-forget .catch() pattern survived on Vercel only
    // when the instance happened to stay warm. Persisting BOTH messages
    // here (after success) also fixes the duplicate-user-turn bug when a
    // failed AI call was retried.
    after(async () => {
      try {
        const callId = await logCoachCall({
          user_id: userId,
          route: '/api/coach/chat/ask',
          query_type: queryType,
          model: chatModel,
          context_tokens: stats.totalTokens,
          context_budget: TOKEN_BUDGETS_PER_QUERY[queryType],
          ceiling_hit: stats.totalTokens >= TOKEN_BUDGETS_PER_QUERY[queryType] * 0.95,
          cache_used: true,
          preflight_ok: preflight.ok,
          preflight_warnings: serializeWarnings(preflight.warnings),
          preflight_augmented: !!preflight.augmentedSystemSuffix,
          latency_ms: callLatencyMs,
          status: response.error ? 'error' : 'ok',
          error_message: response.error ?? null,
          plan_modified: planUpdated,
        });

        if (chatSessionId && lastUserMessage) {
          await supabase.from('coach_chat_messages').insert([
            {
              session_id: chatSessionId,
              user_id: userId,
              role: 'user',
              content: lastUserMessage.content,
            },
            {
              session_id: chatSessionId,
              user_id: userId,
              role: 'assistant',
              content: displayContent,
              supervisor: {
                callId,
                preflightOk: preflight.ok,
                warnings: preflight.warnings,
              },
            },
          ]);
          const { count } = await supabase
            .from('coach_chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', chatSessionId);
          await supabase
            .from('coach_chat_sessions')
            .update({ message_count: count || 0, updated_at: new Date().toISOString() })
            .eq('id', chatSessionId);
        }

        if (!response.error && callId) {
          await runCritic({
            userId,
            callId,
            route: '/api/coach/chat/ask',
            queryType,
            userQuery: query,
            coachResponse: displayContent,
            contextSummary: summarizeContext(context, isPlanModification, currentWeek),
            preflightWarnings: preflight.warnings,
          });
        }
      } catch (err) {
        console.warn('post-response bookkeeping failed:', err instanceof Error ? err.message : err);
      }
    });

    return NextResponse.json({
      content: displayContent,
      sources: {
        books: context.bookContext.sources,
        coachWorkouts: context.coachContext.workoutsIncluded,
      },
      metadata: {
        queryType,
        fatigueScore: context.userContext.metadata.fatigueScore,
        currentPhase: context.userContext.metadata.currentPhase,
        contextStats: stats,
        planModification: isPlanModification,
        planUpdated,
        adjustmentSummary,
      },
      supervisor: {
        callId: null,
        preflightOk: preflight.ok,
        warnings: preflight.warnings,
      },
      sessionId: chatSessionId,
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}

function summarizeContext(
  context: import('@/lib/rag/types').EnhancedContext,
  isPlanModification: boolean,
  currentWeek: number,
): string {
  const u = context.userContext.metadata;
  const lines = [
    `current_phase=${u.currentPhase || 'none'} fatigue=${u.fatigueScore === null ? 'n/a' : u.fatigueScore.toFixed(1) + '/10'} runs_in_context=${u.runsIncluded} has_plan=${u.hasActivePlan}`,
    `book_sources=${context.bookContext.sources.length} coach_workouts=${context.coachContext.workoutsIncluded.length}`,
    `query_week=${currentWeek} plan_modification=${isPlanModification}`,
  ];
  return lines.join('\n');
}
