import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';

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
- Nutrition values must be per 100g, never 0 for real food
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

    // Try to match each ingredient against USDA for better accuracy
    const enriched = await Promise.all(
      ingredients.map(async (ing: AnalyzedIngredient) => {
        const { data: usdaMatch } = await caltrackDb
          .from('usda_foundation')
          .select('fdc_id,description,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g')
          .ilike('description', `%${ing.name_en}%`)
          .limit(1);

        const usda = usdaMatch?.[0];
        const factor = ing.estimated_grams / 100;

        const cal100 = usda?.calories_per_100g || ing.calories_per_100g;
        const pro100 = usda?.protein_per_100g || ing.protein_per_100g;
        const carb100 = usda?.carbs_per_100g || ing.carbs_per_100g;
        const fat100 = usda?.fat_per_100g || ing.fat_per_100g;
        const fib100 = usda?.fiber_per_100g || ing.fiber_per_100g;

        return {
          name_en: usda?.description || ing.name_en,
          name_he: ing.name_he,
          fdc_id: usda?.fdc_id || null,
          source: usda ? 'usda' : 'ai',
          estimated_grams: ing.estimated_grams,
          per_100g: {
            calories: cal100,
            protein: pro100,
            carbs: carb100,
            fat: fat100,
            fiber: fib100,
          },
          calculated: {
            calories: Math.round(cal100 * factor),
            protein: Math.round(pro100 * factor * 10) / 10,
            carbs: Math.round(carb100 * factor * 10) / 10,
            fat: Math.round(fat100 * factor * 10) / 10,
            fiber: Math.round(fib100 * factor * 10) / 10,
          },
        };
      })
    );

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
