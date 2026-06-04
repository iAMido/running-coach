import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { caltrackDb, isCaltrackConfigured } from '@/lib/db/supabase-caltrack';
import { randomUUID } from 'crypto';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCaltrackConfigured()) {
    return NextResponse.json({ error: 'CalTrack not configured' }, { status: 503 });
  }

  try {
    const { data: profile } = await caltrackDb.from('user_profile').select('id').limit(1).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

    const { data: templates, error } = await caltrackDb
      .from('meal_templates')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const templateIds = (templates || []).map((t: { id: string }) => t.id);
    let itemsByTemplate: Record<string, unknown[]> = {};

    if (templateIds.length > 0) {
      const { data: items } = await caltrackDb
        .from('meal_template_items')
        .select('*')
        .in('template_id', templateIds);

      for (const item of items || []) {
        const ti = item as { template_id: string };
        if (!itemsByTemplate[ti.template_id]) itemsByTemplate[ti.template_id] = [];
        itemsByTemplate[ti.template_id].push(item);
      }
    }

    const enriched = (templates || []).map((t: { id: string }) => ({
      ...t,
      items: itemsByTemplate[t.id] || [],
    }));

    return NextResponse.json({ templates: enriched });
  } catch (error) {
    console.error('Templates GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}

interface TemplateIngredient {
  name_en: string;
  fdc_id?: number | null;
  weight_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCaltrackConfigured()) {
    return NextResponse.json({ error: 'CalTrack not configured' }, { status: 503 });
  }

  try {
    const { name, ingredients } = (await request.json()) as {
      name: string;
      ingredients: TemplateIngredient[];
    };

    if (!name?.trim() || !ingredients?.length) {
      return NextResponse.json({ error: 'name and ingredients are required' }, { status: 400 });
    }

    const { data: profile } = await caltrackDb.from('user_profile').select('id').limit(1).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

    const totals = ingredients.reduce(
      (acc, ing) => ({
        cal: acc.cal + (ing.calories || 0),
        prot: acc.prot + (ing.protein_g || 0),
        carb: acc.carb + (ing.carbs_g || 0),
        fat: acc.fat + (ing.fat_g || 0),
      }),
      { cal: 0, prot: 0, carb: 0, fat: 0 }
    );

    const templateId = randomUUID();

    const { error: tmplError } = await caltrackDb.from('meal_templates').insert({
      id: templateId,
      user_id: profile.id,
      name: name.trim(),
      total_calories: totals.cal,
      total_protein_g: Math.round(totals.prot * 10) / 10,
      total_carbs_g: Math.round(totals.carb * 10) / 10,
      total_fat_g: Math.round(totals.fat * 10) / 10,
    });
    if (tmplError) throw tmplError;

    for (const ing of ingredients) {
      const { error: itemError } = await caltrackDb.from('meal_template_items').insert({
        template_id: templateId,
        ingredient_name: ing.name_en,
        fdc_id: ing.fdc_id || null,
        weight_grams: Math.round(ing.weight_grams),
        calories: ing.calories,
        protein_g: ing.protein_g,
        carbs_g: ing.carbs_g,
        fat_g: ing.fat_g,
        fiber_g: ing.fiber_g || 0,
      });
      if (itemError) throw itemError;
    }

    return NextResponse.json({ success: true, template_id: templateId });
  } catch (error) {
    console.error('Templates POST error:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCaltrackConfigured()) {
    return NextResponse.json({ error: 'CalTrack not configured' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      id: string;
      name?: string;
      ingredients?: TemplateIngredient[];
    };

    if (!body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    // Rename only?
    if (body.name !== undefined && !body.ingredients) {
      const { error } = await caltrackDb
        .from('meal_templates')
        .update({ name: body.name.trim() })
        .eq('id', body.id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // Full replace — recompute totals + swap items
    if (body.ingredients && body.ingredients.length > 0) {
      const totals = body.ingredients.reduce(
        (acc, ing) => ({
          cal: acc.cal + (ing.calories || 0),
          prot: acc.prot + (ing.protein_g || 0),
          carb: acc.carb + (ing.carbs_g || 0),
          fat: acc.fat + (ing.fat_g || 0),
        }),
        { cal: 0, prot: 0, carb: 0, fat: 0 }
      );

      const updates: Record<string, unknown> = {
        total_calories: totals.cal,
        total_protein_g: Math.round(totals.prot * 10) / 10,
        total_carbs_g: Math.round(totals.carb * 10) / 10,
        total_fat_g: Math.round(totals.fat * 10) / 10,
      };
      if (body.name !== undefined) updates.name = body.name.trim();

      const { error: updErr } = await caltrackDb
        .from('meal_templates')
        .update(updates)
        .eq('id', body.id);
      if (updErr) throw updErr;

      // Replace items
      await caltrackDb.from('meal_template_items').delete().eq('template_id', body.id);
      for (const ing of body.ingredients) {
        const { error: itemError } = await caltrackDb.from('meal_template_items').insert({
          template_id: body.id,
          ingredient_name: ing.name_en,
          fdc_id: ing.fdc_id || null,
          weight_grams: Math.round(ing.weight_grams),
          calories: ing.calories,
          protein_g: ing.protein_g,
          carbs_g: ing.carbs_g,
          fat_g: ing.fat_g,
          fiber_g: ing.fiber_g || 0,
        });
        if (itemError) throw itemError;
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'name or ingredients required' }, { status: 400 });
  } catch (error) {
    console.error('Templates PUT error:', error);
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }
}


export async function DELETE(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCaltrackConfigured()) {
    return NextResponse.json({ error: 'CalTrack not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { error } = await caltrackDb.from('meal_templates').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Templates DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  }
}
