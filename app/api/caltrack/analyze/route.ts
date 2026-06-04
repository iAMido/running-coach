export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

const ANALYZE_PROMPT = `You are a clinical dietitian AI for a calorie tracking app.
The user describes what they ate in Hebrew or English. Your job:

1. Break down the dish into individual ingredients
2. Estimate realistic weight in grams for each ingredient
3. Provide nutrition per 100g for each ingredient
4. If the user specifies a weight, use that instead of estimating

Return ONLY a JSON object with this structure (no markdown, no explanation):
{
  "dish_name_en": "English name of the dish",
  "dish_name_he": "Hebrew name of the dish",
  "ingredients": [
    {
      "name_en": "ingredient name in English",
      "name_he": "ingredient name in Hebrew",
      "estimated_grams": 120,
      "calories_per_100g": 165,
      "protein_per_100g": 31,
      "carbs_per_100g": 0,
      "fat_per_100g": 3.6,
      "fiber_per_100g": 0
    }
  ]
}

RULES:
- Be accurate with typical Israeli portion sizes
- For composite dishes (שווארמה בפיתה, סביח, etc.), include ALL components (bread, protein, sauces, vegetables)
- Estimate realistic portions — a pita is ~60g, tahini serving ~30g, hummus serving ~80g, schnitzel portion ~150g
- 1 tablespoon (tbsp/tbs) = ~15g for most foods, ~12g for cottage cheese
- calories_per_100g must NEVER be 0 for real food. Common reference values:
  eggs=155, cottage cheese=98, Bulgarian/feta cheese=264, oats=389, rice=130, chicken breast=165, bread=265, olive oil=884, butter=717, hummus=166, tahini=595, avocado=160
- If unsure about exact nutrition, estimate conservatively but NEVER return 0 calories
- If the dish has a sauce/dressing, include it as a separate ingredient`;

interface AnalyzedIngredient {
  name_en: string;
  name_he: string;
  estimated_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isCaltrackConfigured()) {
    return NextResponse.json(
      { error: 'CalTrack database not configured' },
      { status: 503 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI service not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { description } = body;

    if (!description || typeof description !== 'string' || description.length > 500) {
      return NextResponse.json(
        { error: 'Provide a food description (max 500 chars)' },
        { status: 400 }
      );
    }

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://caltrack.app',
        'X-Title': 'CalTrack',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: ANALYZE_PROMPT },
          { role: 'user', content: description },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content?.trim() || '';

    if (content.startsWith('```')) {
      content = content.split('```')[1].replace(/^json\s*/, '').trim();
    }

    const parsed = JSON.parse(content);
    const ingredients: AnalyzedIngredient[] = parsed.ingredients || [];

    // IMPORTANT: We do NOT override AI per-100g with USDA matches here.
    // A naive `ilike('description', '%${name}%').limit(1)` returns an
    // arbitrary first match — e.g. "egg" → "Egg, whole, dried" at 575
    // kcal/100g — and that wrecks accuracy for the user. The bot's /add
    // command stopped doing this exact thing for the same reason
    // (see CalTrack CLAUDE.md). The AI is told to never return 0 and
    // is the source of truth for composite/Israeli foods.
    //
    // If a strong USDA match (first-segment exact, no modifier penalty)
    // is desirable in the future, do it client-side by calling the bot's
    // scored matcher — but never blindly override AI nutrition values.
    const enriched = ingredients.map((ing: AnalyzedIngredient) => {
      const factor = ing.estimated_grams / 100;
      return {
        name_en: ing.name_en,
        name_he: ing.name_he,
        fdc_id: null as number | null,
        source: 'ai',
        estimated_grams: ing.estimated_grams,
        per_100g: {
          calories: ing.calories_per_100g,
          protein: ing.protein_per_100g,
          carbs: ing.carbs_per_100g,
          fat: ing.fat_per_100g,
          fiber: ing.fiber_per_100g,
        },
        calculated: {
          calories: Math.round(ing.calories_per_100g * factor),
          protein: Math.round(ing.protein_per_100g * factor * 10) / 10,
          carbs: Math.round(ing.carbs_per_100g * factor * 10) / 10,
          fat: Math.round(ing.fat_per_100g * factor * 10) / 10,
          fiber: Math.round(ing.fiber_per_100g * factor * 10) / 10,
        },
      };
    });

    const totals = enriched.reduce(
      (acc, ing) => ({
        calories: acc.calories + ing.calculated.calories,
        protein: Math.round((acc.protein + ing.calculated.protein) * 10) / 10,
        carbs: Math.round((acc.carbs + ing.calculated.carbs) * 10) / 10,
        fat: Math.round((acc.fat + ing.calculated.fat) * 10) / 10,
        fiber: Math.round((acc.fiber + ing.calculated.fiber) * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    return NextResponse.json({
      dish_name_en: parsed.dish_name_en,
      dish_name_he: parsed.dish_name_he,
      ingredients: enriched,
      totals,
    });
  } catch (error) {
    console.error('CalTrack analyze error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze food' },
      { status: 500 }
    );
  }
}
