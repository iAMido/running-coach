'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Bookmark,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Search,
} from 'lucide-react';
import type { MealTemplate, MealTemplateItem } from '@/lib/db/caltrack-types';

// ──────────────────────────────────────────────────────────────────
//  TemplateEditor — reused for both "New" and "Edit" flows.
// ──────────────────────────────────────────────────────────────────

interface EditorIngredient {
  name_en: string;
  weight_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  fdc_id?: number | null;
  per_100g?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
}

function ingredientFromItem(item: MealTemplateItem): EditorIngredient {
  const w = Math.max(item.weight_grams || 1, 1);
  return {
    name_en: item.ingredient_name,
    weight_grams: item.weight_grams,
    calories: item.calories,
    protein_g: item.protein_g,
    carbs_g: item.carbs_g,
    fat_g: item.fat_g,
    fiber_g: item.fiber_g || 0,
    fdc_id: item.fdc_id ?? null,
    per_100g: {
      calories: Math.round((item.calories / w) * 100),
      protein: Math.round((item.protein_g / w) * 100 * 10) / 10,
      carbs: Math.round((item.carbs_g / w) * 100 * 10) / 10,
      fat: Math.round((item.fat_g / w) * 100 * 10) / 10,
      fiber: Math.round(((item.fiber_g || 0) / w) * 100 * 10) / 10,
    },
  };
}

interface AnalyzedIngredient {
  name_en: string;
  name_he?: string;
  fdc_id?: number | null;
  estimated_grams: number;
  per_100g: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  calculated: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: MealTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [ingredients, setIngredients] = useState<EditorIngredient[]>(
    initial?.items.map(ingredientFromItem) || []
  );
  const [description, setDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totals = ingredients.reduce(
    (acc, ing) => ({
      cal: acc.cal + (ing.calories || 0),
      pro: acc.pro + (ing.protein_g || 0),
      carb: acc.carb + (ing.carbs_g || 0),
      fat: acc.fat + (ing.fat_g || 0),
      fib: acc.fib + (ing.fiber_g || 0),
    }),
    { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 }
  );

  const updateField = (
    idx: number,
    field: 'name_en' | 'weight_grams',
    value: string
  ) => {
    setIngredients((prev) => {
      const next = [...prev];
      const ing = { ...next[idx] };
      if (field === 'weight_grams') {
        const grams = Math.max(parseInt(value, 10) || 1, 1);
        ing.weight_grams = grams;
        if (ing.per_100g) {
          const f = grams / 100;
          ing.calories = Math.round(ing.per_100g.calories * f);
          ing.protein_g = Math.round(ing.per_100g.protein * f * 10) / 10;
          ing.carbs_g = Math.round(ing.per_100g.carbs * f * 10) / 10;
          ing.fat_g = Math.round(ing.per_100g.fat * f * 10) / 10;
          ing.fiber_g = Math.round(ing.per_100g.fiber * f * 10) / 10;
        }
      } else if (field === 'name_en') {
        ing.name_en = value;
      }
      next[idx] = ing;
      return next;
    });
  };

  const removeIngredient = (idx: number) =>
    setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const analyzeAndAdd = async () => {
    if (!description.trim()) return;
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/caltrack/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Analysis failed');
        return;
      }
      const data = await res.json();
      const ings: AnalyzedIngredient[] = data.ingredients || [];
      setIngredients((prev) => [
        ...prev,
        ...ings.map((ing) => ({
          name_en: ing.name_en,
          weight_grams: ing.estimated_grams,
          calories: ing.calculated.calories,
          protein_g: ing.calculated.protein,
          carbs_g: ing.calculated.carbs,
          fat_g: ing.calculated.fat,
          fiber_g: ing.calculated.fiber,
          fdc_id: ing.fdc_id ?? null,
          per_100g: ing.per_100g,
        })),
      ]);
      // Auto-name the template from the first analyze if name is empty
      if (!name.trim() && data.dish_name_en) {
        setName(data.dish_name_he || data.dish_name_en);
      }
      setDescription('');
    } catch (e) {
      setError(`Network error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || ingredients.length === 0) {
      setError('Template needs a name and at least one ingredient');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...(initial ? { id: initial.id } : {}),
        name: name.trim(),
        ingredients: ingredients.map((ing) => ({
          name_en: ing.name_en,
          fdc_id: ing.fdc_id ?? null,
          weight_grams: ing.weight_grams,
          calories: ing.calories,
          protein_g: ing.protein_g,
          carbs_g: ing.carbs_g,
          fat_g: ing.fat_g,
          fiber_g: ing.fiber_g,
        })),
      };
      const res = await fetch('/api/caltrack/templates', {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Save failed (${res.status})`);
      }
    } catch (e) {
      setError(`Network error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(14,15,12,0.5)' }}
    >
      <div
        className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl"
        style={{
          background: 'var(--ct-surface)',
          border: '1px solid var(--ct-line)',
          boxShadow: 'var(--ct-shadow-2)',
        }}
      >
        <div
          className="flex items-center justify-between p-5"
          style={{ borderBottom: '1px solid var(--ct-line)' }}
        >
          <h2 className="text-lg font-semibold m-0" style={{ color: 'var(--ct-ink)' }}>
            {initial ? `Edit "${initial.name}"` : 'New template'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--ct-ink-3)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="ct-kicker block mb-2">TEMPLATE NAME</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pita shawarma"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2"
              style={{
                background: 'var(--ct-surface-2)',
                border: '1px solid var(--ct-line)',
                color: 'var(--ct-ink)',
              }}
            />
          </div>

          {/* Ingredients */}
          {ingredients.length > 0 && (
            <div>
              <label className="ct-kicker block mb-2">
                INGREDIENTS ({ingredients.length})
              </label>
              <div className="space-y-2">
                {ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3 space-y-2"
                    style={{
                      background: 'var(--ct-surface-2)',
                      border: '1px solid var(--ct-line)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={ing.name_en}
                        onChange={(e) => updateField(i, 'name_en', e.target.value)}
                        className="flex-1 px-2 py-1 text-sm rounded-lg"
                        style={{
                          border: '1px solid var(--ct-line)',
                          background: 'var(--ct-surface)',
                          color: 'var(--ct-ink)',
                        }}
                      />
                      <button
                        onClick={() => removeIngredient(i)}
                        className="p-1 rounded"
                        style={{ color: 'var(--ct-ink-4)' }}
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-xs ct-mono">
                      <input
                        type="number"
                        value={ing.weight_grams}
                        onChange={(e) => updateField(i, 'weight_grams', e.target.value)}
                        min={1}
                        className="w-20 px-2 py-1 text-center rounded-lg"
                        style={{
                          border: '1px solid var(--ct-line)',
                          background: 'var(--ct-surface)',
                          color: 'var(--ct-ink)',
                        }}
                      />
                      <span style={{ color: 'var(--ct-ink-4)' }}>g</span>
                      <span className="ml-auto" style={{ color: 'var(--ct-ink-3)' }}>
                        {ing.calories} kcal
                      </span>
                      <span style={{ color: 'var(--ct-ink-4)' }}>P:{ing.protein_g}</span>
                      <span style={{ color: 'var(--ct-ink-4)' }}>C:{ing.carbs_g}</span>
                      <span style={{ color: 'var(--ct-ink-4)' }}>F:{ing.fat_g}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Totals strip */}
              <div
                className="mt-3 rounded-xl p-3 grid grid-cols-5 gap-2 text-center text-xs"
                style={{ background: 'var(--ct-ember-soft)' }}
              >
                <div>
                  <p style={{ color: 'var(--ct-ink-3)' }}>Cal</p>
                  <p className="font-bold text-base" style={{ color: 'var(--ct-ember)' }}>
                    {totals.cal}
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--ct-ink-3)' }}>Protein</p>
                  <p className="font-bold" style={{ color: '#3b82f6' }}>
                    {Math.round(totals.pro * 10) / 10}g
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--ct-ink-3)' }}>Carbs</p>
                  <p className="font-bold" style={{ color: 'var(--ct-good)' }}>
                    {Math.round(totals.carb * 10) / 10}g
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--ct-ink-3)' }}>Fat</p>
                  <p className="font-bold" style={{ color: '#a855f7' }}>
                    {Math.round(totals.fat * 10) / 10}g
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--ct-ink-3)' }}>Fiber</p>
                  <p className="font-bold" style={{ color: 'var(--ct-ink)' }}>
                    {Math.round(totals.fib * 10) / 10}g
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Analyzer (add ingredients via AI) */}
          <div>
            <label className="ct-kicker block mb-2">ADD INGREDIENTS</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={'פיתה שווארמה פרגית\nor: 150g chicken breast'}
              rows={2}
              dir="auto"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 resize-none"
              style={{
                background: 'var(--ct-surface-2)',
                border: '1px solid var(--ct-line)',
                color: 'var(--ct-ink)',
              }}
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--ct-ink-4)' }}>
              Hebrew or English — AI breaks down the dish and appends to the list.
            </p>
            <button
              onClick={analyzeAndAdd}
              disabled={!description.trim() || analyzing}
              className="mt-2 w-full py-2.5 rounded-full text-white font-semibold disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
              style={{ background: 'var(--ct-ember)' }}
            >
              {analyzing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Analyze &amp; add
                </>
              )}
            </button>
          </div>

          {error && (
            <div
              className="p-3 rounded-xl text-sm"
              style={{
                background: 'rgba(239,83,80,0.1)',
                color: 'var(--ct-bad)',
                border: '1px solid rgba(239,83,80,0.2)',
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || ingredients.length === 0}
            className="w-full py-3 rounded-full text-white font-semibold disabled:opacity-50 transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MealTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/caltrack/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const deleteTemplate = async (tmpl: MealTemplate) => {
    if (!confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/caltrack/templates?id=${tmpl.id}`, { method: 'DELETE' });
    if (res.ok) setTemplates((prev) => prev.filter((t) => t.id !== tmpl.id));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-5 mb-2" style={{ borderBottom: '1px solid var(--ct-line)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="ct-kicker flex items-center gap-2.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ct-ember)' }} />
              Saved meals
            </div>
            <h1
              className="text-[40px] font-bold leading-none m-0"
              style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
            >
              Templates
            </h1>
            <p className="mt-2.5 text-sm max-w-[620px]" style={{ color: 'var(--ct-ink-3)' }}>
              One-tap re-log from Telegram with{' '}
              <span
                className="ct-mono text-[11.5px] text-white px-1.5 py-0.5 rounded"
                style={{ background: 'var(--ct-ink)' }}
              >
                /t {'<name>'}
              </span>{' '}
              or from the meals page.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-white font-semibold text-sm transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            <Plus className="w-4 h-4" />
            New template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ct-card p-8 text-center" style={{ color: 'var(--ct-ink-3)' }}>
          Loading…
        </div>
      ) : templates.length === 0 ? (
        <div className="ct-card p-12 text-center space-y-3">
          <Bookmark className="w-12 h-12 mx-auto" style={{ color: 'var(--ct-ink-4)' }} />
          <p className="text-base font-medium" style={{ color: 'var(--ct-ink-2)' }}>
            No templates yet
          </p>
          <p className="text-sm" style={{ color: 'var(--ct-ink-4)' }}>
            Click <strong>New template</strong> above, describe what you eat, and save.
          </p>
        </div>
      ) : (
        <div className="ct-card divide-y" style={{ borderColor: 'var(--ct-line)' }}>
          {templates.map((tmpl) => {
            const isExpanded = expandedId === tmpl.id;
            return (
              <div key={tmpl.id} className="p-5" style={{ borderColor: 'var(--ct-line)' }}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3
                      className="text-[17px] font-semibold m-0"
                      style={{ color: 'var(--ct-ink)', letterSpacing: '-0.01em' }}
                    >
                      {tmpl.name}
                    </h3>
                    <div className="ct-mono text-xs mt-1.5" style={{ color: 'var(--ct-ink-3)' }}>
                      {tmpl.total_calories || 0} kcal &middot; P {Math.round(tmpl.total_protein_g || 0)}g
                      &middot; C {Math.round(tmpl.total_carbs_g || 0)}g &middot; F{' '}
                      {Math.round(tmpl.total_fat_g || 0)}g &middot; {tmpl.items.length} item
                      {tmpl.items.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
                      className="p-2 rounded-lg transition-colors hover:opacity-70"
                      style={{
                        color: 'var(--ct-ink-3)',
                        background: 'var(--ct-surface-2)',
                        border: '1px solid var(--ct-line)',
                      }}
                      title={isExpanded ? 'Collapse' : 'Show items'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setEditing(tmpl)}
                      className="p-2 rounded-lg transition-colors hover:opacity-70"
                      style={{
                        color: 'var(--ct-ink-3)',
                        background: 'var(--ct-surface-2)',
                        border: '1px solid var(--ct-line)',
                      }}
                      title="Edit ingredients"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteTemplate(tmpl)}
                      className="p-2 rounded-lg transition-colors hover:opacity-70"
                      style={{
                        color: 'var(--ct-bad)',
                        background: 'rgba(239,83,80,0.05)',
                        border: '1px solid rgba(239,83,80,0.2)',
                      }}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    className="mt-4 pt-3 space-y-2"
                    style={{ borderTop: '1px solid var(--ct-line)' }}
                  >
                    {tmpl.items.length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--ct-ink-4)' }}>
                        No items in this template.
                      </p>
                    ) : (
                      tmpl.items.map((item: MealTemplateItem) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between py-2 text-sm"
                          style={{ borderBottom: '1px solid var(--ct-line)' }}
                        >
                          <div>
                            <span className="font-medium" style={{ color: 'var(--ct-ink)' }}>
                              {item.ingredient_name}
                            </span>
                            <span className="ct-mono text-xs ml-2" style={{ color: 'var(--ct-ink-4)' }}>
                              {item.weight_grams}g
                            </span>
                          </div>
                          <span className="ct-mono text-xs font-medium" style={{ color: 'var(--ct-ink-3)' }}>
                            {item.calories} kcal &middot; P {item.protein_g}g
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <TemplateEditor
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={fetchTemplates}
        />
      )}
    </div>
  );
}
