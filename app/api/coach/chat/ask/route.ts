import { NextRequest, NextResponse } from 'next/server';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedCoachSystemPrompt } from '@/lib/ai/coach-prompts';
import { buildContext, detectQueryType, getContextStats } from '@/lib/rag/context-builder';
import type { ChatMessage } from '@/lib/db/types';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { chatRequestSchema, validateInput } from '@/lib/validation/schemas';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';

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

    const { messages } = validation.data as { messages: ChatMessage[] };

    // Get the user's query from the last message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const query = lastUserMessage?.content || '';

    // Detect query type and build 3-layer context
    const queryType = detectQueryType(query);
    const context = await buildContext(userId, query, queryType);

    // Check if this is a plan modification request
    const isPlanModification = detectPlanModificationIntent(query);
    let activePlan = null;
    let currentWeek = 1;

    if (isPlanModification) {
      // Get active plan for modification
      const { data: plan } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (plan) {
        activePlan = plan;
        const startDate = plan.start_date || (plan.created_at ? plan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
        const weekInfo = calculateCurrentWeek(startDate, plan.duration_weeks);
        currentWeek = weekInfo.currentWeek;
      }
    }

    // Build system prompt - enhanced for plan modification if needed
    let systemPrompt: string;
    if (isPlanModification && activePlan) {
      const basePrompt = buildEnhancedCoachSystemPrompt(context);
      systemPrompt = buildPlanModificationPrompt(
        basePrompt,
        activePlan.plan_json,
        currentWeek,
        query
      );
    } else {
      systemPrompt = buildEnhancedCoachSystemPrompt(context);
    }

    // Build messages array
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Call OpenRouter with more tokens for plan modifications
    const response = await callOpenRouter(apiMessages, {
      apiKey,
      maxTokens: isPlanModification ? 4000 : 1500
    });

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
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
