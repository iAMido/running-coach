'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronDown,
  ChevronUp,
  UtensilsCrossed,
  Plus,
  X,
  Search,
  Pencil,
  Trash2,
  Minus,
} from 'lucide-react';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';
import type { CaltrackMeal, CaltrackMealItem } from '@/lib/db/caltrack-types';

type MealFilter = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'snack';

const mealTypeBadge: Record<string, { bg: string; color: string }> = {
  breakfast: { bg: 'oklch(0.96 0.04 75)', color: 'oklch(0.50 0.15 75)' },
  lunch: { bg: 'oklch(0.96 0.03 240)', color: 'oklch(0.42 0.13 240)' },
  dinner: { bg: 'oklch(0.96 0.03 305)', color: 'oklch(0.42 0.16 305)' },
  snack: { bg: 'oklch(0.96 0.04 150)', color: 'oklch(0.42 0.10 150)' },
};

const CALTRACK_STORAGE_URL =
  process.env.NEXT_PUBLIC_CALTRACK_STORAGE_URL || '';

// ─── Add Meal Modal ───
interface AnalyzedIngredient {
  name_en: string;
  name_he: string;
  fdc_id: number | null;
  source: string;
  estimated_grams: number;
  per_100g: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  calculated: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}

interface AnalysisResult {
  dish_name_en: string;
  dish_name_he: string;
  ingredients: AnalyzedIngredient[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}

function AddMealModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const nowStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:MM
  const [mealType, setMealType] = useState<string>('lunch');
  const [mealDate, setMealDate] = useState(todayStr);
  const [mealTime, setMealTime] = useState(nowStr);
  const [description, setDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!description.trim()) return;
    setAnalyzing(true);
    setError('');
    setAnalysis(null);
    try {
      const res = await fetch('/api/caltrack/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (res.ok) {
        setAnalysis(await res.json());
      } else {
        const data = await res.json();
        setError(data.error || 'Analysis failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setAnalyzing(false);
    }
  };

  const updateIngredientGrams = (index: number, newGrams: number) => {
    if (!analysis) return;
    const updated = { ...analysis };
    const ing = { ...updated.ingredients[index] };
    const factor = newGrams / 100;
    ing.estimated_grams = newGrams;
    ing.calculated = {
      calories: Math.round(ing.per_100g.calories * factor),
      protein: Math.round(ing.per_100g.protein * factor * 10) / 10,
      carbs: Math.round(ing.per_100g.carbs * factor * 10) / 10,
      fat: Math.round(ing.per_100g.fat * factor * 10) / 10,
      fiber: Math.round(ing.per_100g.fiber * factor * 10) / 10,
    };
    updated.ingredients = [...updated.ingredients];
    updated.ingredients[index] = ing;
    updated.totals = updated.ingredients.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calculated.calories,
        protein: Math.round((acc.protein + i.calculated.protein) * 10) / 10,
        carbs: Math.round((acc.carbs + i.calculated.carbs) * 10) / 10,
        fat: Math.round((acc.fat + i.calculated.fat) * 10) / 10,
        fiber: Math.round((acc.fiber + i.calculated.fiber) * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );
    setAnalysis(updated);
  };

  const removeIngredient = (index: number) => {
    if (!analysis) return;
    const updated = { ...analysis };
    updated.ingredients = updated.ingredients.filter((_, i) => i !== index);
    updated.totals = updated.ingredients.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calculated.calories,
        protein: Math.round((acc.protein + i.calculated.protein) * 10) / 10,
        carbs: Math.round((acc.carbs + i.calculated.carbs) * 10) / 10,
        fat: Math.round((acc.fat + i.calculated.fat) * 10) / 10,
        fiber: Math.round((acc.fiber + i.calculated.fiber) * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );
    setAnalysis(updated);
  };

  const handleConfirm = async () => {
    if (!analysis || !analysis.ingredients.length) return;
    setSubmitting(true);
    setError('');
    try {
      const eaten_at = new Date(`${mealDate}T${mealTime}:00`).toISOString();
      const res = await fetch('/api/caltrack/meals/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_type: mealType,
          eaten_at,
          description,
          ingredients: analysis.ingredients.map((ing) => ({
            name_en: ing.name_en,
            name_he: ing.name_he,
            fdc_id: ing.fdc_id,
            grams: ing.estimated_grams,
            calories: ing.calculated.calories,
            protein_g: ing.calculated.protein,
            carbs_g: ing.calculated.carbs,
            fat_g: ing.calculated.fat,
            fiber_g: ing.calculated.fiber,
          })),
        }),
      });
      if (res.ok) {
        onAdded();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,15,12,0.5)' }}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', boxShadow: 'var(--ct-shadow-2)' }}
      >
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--ct-line)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ct-ink)' }}>Add Meal</h2>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--ct-ink-3)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Date & Time */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="ct-kicker block mb-2">DATE</label>
              <input
                type="date"
                value={mealDate}
                max={todayStr}
                onChange={(e) => setMealDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 ct-mono"
                style={{
                  background: 'var(--ct-surface-2)',
                  border: '1px solid var(--ct-line)',
                  color: 'var(--ct-ink)',
                }}
              />
            </div>
            <div className="flex-1">
              <label className="ct-kicker block mb-2">TIME</label>
              <input
                type="time"
                value={mealTime}
                onChange={(e) => setMealTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 ct-mono"
                style={{
                  background: 'var(--ct-surface-2)',
                  border: '1px solid var(--ct-line)',
                  color: 'var(--ct-ink)',
                }}
              />
            </div>
          </div>

          {/* Meal type */}
          <div>
            <label className="ct-kicker block mb-2">MEAL TYPE</label>
            <div
              className="inline-flex gap-[1px] rounded-full p-[3px]"
              style={{ background: 'var(--ct-surface-2)', border: '1px solid var(--ct-line)' }}
            >
              {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className="ct-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors"
                  style={{
                    background: mealType === type ? 'var(--ct-ink)' : 'transparent',
                    color: mealType === type ? '#fff' : 'var(--ct-ink-3)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Free-text input */}
          <div>
            <label className="ct-kicker block mb-2">WHAT DID YOU EAT?</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"פיתה שווארמה פרגית\nסושי סלמון רול\nchicken breast with rice and salad"}
              rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 resize-none"
              style={{
                background: 'var(--ct-surface-2)',
                border: '1px solid var(--ct-line)',
                color: 'var(--ct-ink)',
              }}
              dir="auto"
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--ct-ink-4)' }}>
              Hebrew or English — AI will identify ingredients
            </p>
          </div>

          {!analysis && (
            <button
              onClick={handleAnalyze}
              disabled={!description.trim() || analyzing}
              className="w-full py-3 rounded-full text-white font-semibold disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
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
                  Analyze Food
                </>
              )}
            </button>
          )}

          {/* Analysis results */}
          {analysis && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--ct-ink)' }}>{analysis.dish_name_he}</p>
                  <p className="text-sm" style={{ color: 'var(--ct-ink-3)' }}>{analysis.dish_name_en}</p>
                </div>
                <button
                  onClick={() => setAnalysis(null)}
                  className="text-xs px-2 py-1 rounded-lg transition-colors"
                  style={{ color: 'var(--ct-ink-3)' }}
                >
                  Re-analyze
                </button>
              </div>

              <div className="space-y-2">
                {analysis.ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: 'var(--ct-surface-2)', border: '1px solid var(--ct-line)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium" style={{ color: 'var(--ct-ink)' }}>{ing.name_he || ing.name_en}</span>
                        {ing.name_he && (
                          <span className="text-xs ml-1.5" style={{ color: 'var(--ct-ink-3)' }}>({ing.name_en})</span>
                        )}
                        <span
                          className="ct-mono text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full"
                          style={{
                            background: ing.source === 'usda' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                            color: ing.source === 'usda' ? 'var(--ct-good)' : '#3b82f6',
                          }}
                        >
                          {ing.source === 'usda' ? 'USDA' : 'AI'}
                        </span>
                      </div>
                      <button onClick={() => removeIngredient(i)} className="p-1 rounded" style={{ color: 'var(--ct-ink-4)' }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={ing.estimated_grams}
                        onChange={(e) => updateIngredientGrams(i, Math.max(1, Number(e.target.value)))}
                        className="w-20 px-2 py-1 text-sm rounded-lg ct-mono text-center"
                        style={{ border: '1px solid var(--ct-line)', background: 'var(--ct-surface)', color: 'var(--ct-ink)' }}
                        min="1"
                      />
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>g</span>
                      <span className="text-xs ct-mono ml-auto" style={{ color: 'var(--ct-ink-3)' }}>{ing.calculated.calories} kcal</span>
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>P:{ing.calculated.protein}</span>
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>C:{ing.calculated.carbs}</span>
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>F:{ing.calculated.fat}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="rounded-xl p-3" style={{ background: 'var(--ct-ember-soft)', border: '1px solid rgba(0,0,0,0.04)' }}>
                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--ct-ink)' }}>Total</p>
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  <div><p style={{ color: 'var(--ct-ink-3)' }}>Cal</p><p className="font-bold text-base" style={{ color: 'var(--ct-ember)' }}>{analysis.totals.calories}</p></div>
                  <div><p style={{ color: 'var(--ct-ink-3)' }}>Protein</p><p className="font-bold" style={{ color: '#3b82f6' }}>{analysis.totals.protein}g</p></div>
                  <div><p style={{ color: 'var(--ct-ink-3)' }}>Carbs</p><p className="font-bold" style={{ color: 'var(--ct-good)' }}>{analysis.totals.carbs}g</p></div>
                  <div><p style={{ color: 'var(--ct-ink-3)' }}>Fat</p><p className="font-bold" style={{ color: '#a855f7' }}>{analysis.totals.fat}g</p></div>
                  <div><p style={{ color: 'var(--ct-ink-3)' }}>Fiber</p><p className="font-bold" style={{ color: 'var(--ct-ink)' }}>{analysis.totals.fiber}g</p></div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,83,80,0.1)', color: 'var(--ct-bad)', border: '1px solid rgba(239,83,80,0.2)' }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleConfirm}
                disabled={submitting || !analysis.ingredients.length}
                className="w-full py-3 rounded-full text-white font-semibold disabled:opacity-50 transition-colors"
                style={{ background: 'var(--ct-ember)' }}
              >
                {submitting ? 'Saving…' : `Confirm & Save (${analysis.totals.calories} kcal)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Photo Lightbox ───
function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ background: 'rgba(14,15,12,0.85)' }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full text-white"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      >
        <X className="w-6 h-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Meal photo"
        className="max-w-full max-h-[85vh] rounded-xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Edit Meal Modal ───
interface EditIngredient {
  name_en: string;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  fdc_id?: number | null;
}

function EditMealModal({
  meal,
  items,
  onClose,
  onSaved,
}: {
  meal: CaltrackMeal;
  items: CaltrackMealItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mealType, setMealType] = useState(meal.meal_type);
  const [ingredients, setIngredients] = useState<EditIngredient[]>(
    items.map((it) => ({
      name_en: it.ingredient_name,
      grams: it.weight_grams,
      calories: it.calories,
      protein_g: it.protein_g,
      carbs_g: it.carbs_g,
      fat_g: it.fat_g,
      fiber_g: it.fiber_g,
      fdc_id: it.fdc_id,
    }))
  );
  const [newName, setNewName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const updateIngredient = (idx: number, field: string, value: string) => {
    setIngredients((prev) => {
      const updated = [...prev];
      const num = parseFloat(value) || 0;
      if (field === 'grams') {
        const oldGrams = updated[idx].grams || 1;
        const ratio = num / oldGrams;
        updated[idx] = {
          ...updated[idx],
          grams: num,
          calories: Math.round(updated[idx].calories * ratio),
          protein_g: Math.round(updated[idx].protein_g * ratio * 10) / 10,
          carbs_g: Math.round(updated[idx].carbs_g * ratio * 10) / 10,
          fat_g: Math.round(updated[idx].fat_g * ratio * 10) / 10,
          fiber_g: Math.round(updated[idx].fiber_g * ratio * 10) / 10,
        };
      } else {
        updated[idx] = { ...updated[idx], [field]: num };
      }
      return updated;
    });
  };

  const removeIngredient = (idx: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  };

  const addIngredient = async () => {
    if (!newName.trim()) return;
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/caltrack/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newName }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const data = await res.json();
      const newIngs: EditIngredient[] = (data.ingredients || []).map(
        (ing: AnalyzedIngredient) => ({
          name_en: ing.name_en,
          grams: ing.estimated_grams,
          calories: ing.calculated.calories,
          protein_g: ing.calculated.protein,
          carbs_g: ing.calculated.carbs,
          fat_g: ing.calculated.fat,
          fiber_g: ing.calculated.fiber,
          fdc_id: ing.fdc_id,
        })
      );
      setIngredients((prev) => [...prev, ...newIngs]);
      setNewName('');
    } catch {
      setError('Failed to analyze new ingredient');
    } finally {
      setAnalyzing(false);
    }
  };

  const [recalculating, setRecalculating] = useState(false);

  const handleRecalculate = async () => {
    if (!ingredients.length) return;
    setRecalculating(true);
    setError('');
    try {
      const description = ingredients
        .map((ing) => `${ing.grams}g ${ing.name_en}`)
        .join(', ');
      const res = await fetch('/api/caltrack/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error('Recalculation failed');
      const data = await res.json();
      const analyzed: AnalyzedIngredient[] = data.ingredients || [];

      setIngredients((prev) =>
        prev.map((ing) => {
          const match = analyzed.find(
            (a) =>
              a.name_en.toLowerCase().includes(ing.name_en.toLowerCase()) ||
              ing.name_en.toLowerCase().includes(a.name_en.toLowerCase())
          );
          if (match) {
            const factor = ing.grams / 100;
            return {
              ...ing,
              calories: Math.round(match.per_100g.calories * factor),
              protein_g: Math.round(match.per_100g.protein * factor * 10) / 10,
              carbs_g: Math.round(match.per_100g.carbs * factor * 10) / 10,
              fat_g: Math.round(match.per_100g.fat * factor * 10) / 10,
              fiber_g: Math.round(match.per_100g.fiber * factor * 10) / 10,
              fdc_id: match.fdc_id,
            };
          }
          return ing;
        })
      );
    } catch {
      setError('Recalculation failed. Try again.');
    } finally {
      setRecalculating(false);
    }
  };

  const totals = ingredients.reduce(
    (acc, ing) => ({
      calories: acc.calories + (ing.calories || 0),
      protein: acc.protein + (ing.protein_g || 0),
      carbs: acc.carbs + (ing.carbs_g || 0),
      fat: acc.fat + (ing.fat_g || 0),
      fiber: acc.fiber + (ing.fiber_g || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );

  const handleSave = async () => {
    if (!ingredients.length) return;
    setSaving(true);
    setError('');
    try {
      const typeChanged = mealType !== meal.meal_type;
      const res = await fetch('/api/caltrack/meals/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_id: meal.id,
          ...(typeChanged ? { meal_type: mealType } : {}),
          ingredients: ingredients.map((ing) => ({
            name_en: ing.name_en,
            fdc_id: ing.fdc_id,
            grams: ing.grams,
            calories: ing.calories,
            protein_g: ing.protein_g,
            carbs_g: ing.carbs_g,
            fat_g: ing.fat_g,
            fiber_g: ing.fiber_g,
          })),
        }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/caltrack/meals/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: meal.id }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Delete failed (${res.status})`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,15,12,0.5)' }}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', boxShadow: 'var(--ct-shadow-2)' }}
      >
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--ct-line)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ct-ink)' }}>Edit Meal</h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--ct-ink-3)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Meal type selector */}
          <div>
            <label className="ct-kicker block mb-2">MEAL TYPE</label>
            <div
              className="inline-flex gap-[1px] rounded-full p-[3px]"
              style={{ background: 'var(--ct-surface-2)', border: '1px solid var(--ct-line)' }}
            >
              {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className="ct-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors"
                  style={{
                    background: mealType === type ? 'var(--ct-ink)' : 'transparent',
                    color: mealType === type ? '#fff' : 'var(--ct-ink-3)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="ct-kicker block mb-2">INGREDIENTS</label>
            <div className="space-y-2">
              {ingredients.map((ing, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-3 rounded-xl"
                  style={{
                    background: ing.calories === 0 ? 'rgba(239,83,80,0.05)' : 'var(--ct-surface-2)',
                    border: `1px solid ${ing.calories === 0 ? 'rgba(239,83,80,0.3)' : 'var(--ct-line)'}`,
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--ct-ink)' }}>{ing.name_en}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={ing.grams}
                        onChange={(e) => updateIngredient(idx, 'grams', e.target.value)}
                        className="w-16 px-2 py-0.5 text-xs rounded-lg ct-mono text-center"
                        style={{ border: '1px solid var(--ct-line)', background: 'var(--ct-surface)', color: 'var(--ct-ink)' }}
                      />
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>g</span>
                      <input
                        type="number"
                        value={ing.calories}
                        onChange={(e) => updateIngredient(idx, 'calories', e.target.value)}
                        className="w-16 px-2 py-0.5 text-xs rounded-lg ct-mono text-center ml-auto"
                        style={{
                          border: `1px solid ${ing.calories === 0 ? 'rgba(239,83,80,0.5)' : 'var(--ct-line)'}`,
                          background: ing.calories === 0 ? 'rgba(239,83,80,0.1)' : 'var(--ct-surface)',
                          color: ing.calories === 0 ? 'var(--ct-bad)' : 'var(--ct-ink)',
                        }}
                      />
                      <span className="text-xs ct-mono" style={{ color: 'var(--ct-ink-4)' }}>kcal</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeIngredient(idx)}
                    className="p-1 rounded shrink-0"
                    style={{ color: 'var(--ct-ink-4)' }}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
              <input
                type="text"
                placeholder="Add ingredient (e.g. חומוס, rice)…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addIngredient()}
                className="flex-1 px-3 py-2 text-sm rounded-xl focus:outline-none focus:ring-2"
                style={{ border: '1px solid var(--ct-line)', background: 'var(--ct-surface-2)', color: 'var(--ct-ink)' }}
              />
              <button
                onClick={addIngredient}
                disabled={analyzing || !newName.trim()}
                className="px-3 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
                style={{ background: 'var(--ct-surface-2)', color: 'var(--ct-ink-3)', border: '1px solid var(--ct-line)' }}
              >
                {analyzing ? '…' : '+ Add'}
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs p-3 rounded-xl" style={{ background: 'var(--ct-surface-2)' }}>
            <div><p style={{ color: 'var(--ct-ink-4)' }}>Calories</p><p className="font-bold" style={{ color: 'var(--ct-ember)' }}>{Math.round(totals.calories)}</p></div>
            <div><p style={{ color: 'var(--ct-ink-4)' }}>Protein</p><p className="font-bold" style={{ color: '#3b82f6' }}>{Math.round(totals.protein)}g</p></div>
            <div><p style={{ color: 'var(--ct-ink-4)' }}>Carbs</p><p className="font-bold" style={{ color: 'var(--ct-good)' }}>{Math.round(totals.carbs)}g</p></div>
            <div><p style={{ color: 'var(--ct-ink-4)' }}>Fat</p><p className="font-bold" style={{ color: '#a855f7' }}>{Math.round(totals.fat)}g</p></div>
            <div><p style={{ color: 'var(--ct-ink-4)' }}>Fiber</p><p className="font-bold" style={{ color: 'var(--ct-ink)' }}>{Math.round(totals.fiber)}g</p></div>
          </div>

          {error && (
            <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,83,80,0.1)', color: 'var(--ct-bad)', border: '1px solid rgba(239,83,80,0.2)' }}>
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleRecalculate}
              disabled={recalculating || !ingredients.length}
              className="px-4 py-2.5 rounded-full font-medium disabled:opacity-50 transition-colors"
              style={{ border: '1px solid var(--ct-line)', color: 'var(--ct-ember)' }}
            >
              {recalculating ? 'Calculating…' : 'Recalculate'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !ingredients.length}
              className="flex-1 py-2.5 rounded-full text-white font-semibold disabled:opacity-50 transition-colors"
              style={{ background: 'var(--ct-ember)' }}
            >
              {saving ? 'Saving…' : `Save (${Math.round(totals.calories)} kcal)`}
            </button>
          </div>

          <div className="pt-3" style={{ borderTop: '1px solid var(--ct-line)' }}>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--ct-bad)' }}>Delete this meal?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 text-sm font-medium rounded-full text-white disabled:opacity-50"
                  style={{ background: 'var(--ct-bad)' }}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-full"
                  style={{ border: '1px solid var(--ct-line)', color: 'var(--ct-ink-3)' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: 'var(--ct-ink-3)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete meal
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function MealsPage() {
  const [meals, setMeals] = useState<CaltrackMeal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MealFilter>('all');
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const [mealItems, setMealItems] = useState<Record<string, CaltrackMealItem[]>>({});
  const [days, setDays] = useState(7);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<CaltrackMeal | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [calorieTarget, setCalorieTarget] = useState(2285);
  const [mealSearch, setMealSearch] = useState('');

  const fetchMeals = useCallback(async () => {
    setLoading(true);
    let params: URLSearchParams;

    if (customRange) {
      params = new URLSearchParams({
        from: customRange.from,
        to: customRange.to,
        limit: '100',
      });
    } else {
      const from = new Date();
      from.setDate(from.getDate() - days);
      params = new URLSearchParams({
        from: from.toISOString().split('T')[0],
        limit: '100',
      });
    }
    if (filter !== 'all') params.set('meal_type', filter);

    try {
      const res = await fetch(`/api/caltrack/meals?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMeals(data.meals);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Failed to fetch meals:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, days, customRange]);

  useEffect(() => {
    fetchMeals();
  }, [fetchMeals]);

  // Fetch calorie target from overview
  useEffect(() => {
    fetch('/api/caltrack/overview?days=7')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.today?.target) setCalorieTarget(d.today.target); })
      .catch(() => {});
  }, []);

  const toggleMeal = async (mealId: string) => {
    if (expandedMeal === mealId) {
      setExpandedMeal(null);
      return;
    }
    setExpandedMeal(mealId);

    if (!mealItems[mealId]) {
      try {
        const res = await fetch(`/api/caltrack/meals?id=${mealId}`);
        if (res.ok) {
          const data = await res.json();
          setMealItems((prev) => ({ ...prev, [mealId]: data.items }));
        }
      } catch (err) {
        console.error('Failed to fetch meal items:', err);
      }
    }
  };

  const getPhotoUrl = (meal: CaltrackMeal) => {
    if (!meal.photo_storage_path || !CALTRACK_STORAGE_URL) return null;
    return `${CALTRACK_STORAGE_URL}/storage/v1/object/authenticated/meals/${meal.photo_storage_path}`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const h = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const parts = h.split(' ');
    return { time: parts[0], period: parts[1] || '' };
  };

  const groupByDate = (meals: CaltrackMeal[]) => {
    const groups: Record<string, CaltrackMeal[]> = {};
    for (const meal of meals) {
      const date = meal.eaten_at.split('T')[0];
      if (!groups[date]) groups[date] = [];
      groups[date].push(meal);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-20" style={{ background: 'rgba(14,15,12,0.06)' }} />
          ))}
        </div>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-20" style={{ background: 'rgba(14,15,12,0.06)' }} />
        ))}
      </div>
    );
  }

  // Apply search filter
  const filteredMeals = mealSearch
    ? meals.filter((m) => {
        const q = mealSearch.toLowerCase();
        return (
          m.notes?.toLowerCase().includes(q) ||
          m.item_names?.some((n) => n.toLowerCase().includes(q)) ||
          m.meal_type.toLowerCase().includes(q)
        );
      })
    : meals;
  const grouped = groupByDate(filteredMeals);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <div className="ct-kicker mb-2">
            <span
              className="inline-block w-[6px] h-[6px] rounded-full mr-2"
              style={{ background: 'var(--ct-ember)' }}
            />
            MEAL LOG · {days === -1 ? 'CUSTOM' : `${days} DAYS`}
          </div>
          <h1
            className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
            style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
          >
            Meals, <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ct-ink)' }}>in order.</span>
          </h1>
          <p className="mt-2.5 text-sm" style={{ color: 'var(--ct-ink-3)', maxWidth: 620 }}>
            {total} meals across the last {days === -1 ? 'selected period' : `${days} days`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-white transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            <Plus className="w-4 h-4" />
            Add Meal
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="inline-flex gap-[6px] flex-wrap">
          {(['all', 'breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => {
            const count = type === 'all' ? meals.length : meals.filter(m => m.meal_type === type).length;
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className="px-[14px] py-[8px] rounded-full text-[12.5px] font-medium transition-colors"
                style={{
                  background: filter === type ? 'var(--ct-ember)' : 'var(--ct-surface)',
                  color: filter === type ? '#fff' : 'var(--ct-ink-3)',
                  border: `1px solid ${filter === type ? 'var(--ct-ember)' : 'var(--ct-line)'}`,
                  boxShadow: 'var(--ct-shadow-1)',
                }}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
                <span className="ct-mono ml-1 text-[11px]" style={{ opacity: 0.6 }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative hidden sm:block" style={{ width: 280 }}>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ct-ink-4)' }} />
            <input
              type="text"
              placeholder="Search meals…"
              value={mealSearch}
              onChange={(e) => setMealSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-full text-sm focus:outline-none focus:ring-2"
              style={{
                background: 'var(--ct-surface)',
                border: '1px solid var(--ct-line)',
                color: 'var(--ct-ink)',
                boxShadow: 'var(--ct-shadow-1)',
              }}
            />
          </div>
          <DateRangePicker
            selectedDays={days}
            onChange={(d) => { setDays(d); setCustomRange(undefined); }}
            customRange={customRange}
            onCustomRange={(from, to) => { setCustomRange({ from, to }); setDays(-1); }}
          />
        </div>
      </div>

      {/* Summary Strip */}
      {meals.length > 0 && (() => {
        const totalIntake = meals.reduce((s, m) => s + (m.total_calories || 0), 0);
        const uniqueDays = new Set(meals.map(m => m.eaten_at.split('T')[0])).size;
        const dailyAvg = uniqueDays > 0 ? Math.round(totalIntake / uniqueDays) : 0;
        // Find most-logged food name
        const foodCounts: Record<string, number> = {};
        meals.forEach(m => {
          if (m.item_names) m.item_names.forEach(n => { foodCounts[n] = (foodCounts[n] || 0) + 1; });
        });
        const mostLogged = Object.entries(foodCounts).sort((a, b) => b[1] - a[1])[0];
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Logged meals', value: String(meals.length), unit: '' },
              { label: 'Total intake', value: totalIntake.toLocaleString(), unit: 'kcal' },
              { label: 'Daily average', value: dailyAvg.toLocaleString(), unit: 'kcal' },
              { label: 'Most-logged', value: mostLogged ? mostLogged[0] : '—', unit: '', isText: true },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-[14px] px-[18px] py-4"
                style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', boxShadow: 'var(--ct-shadow-1)' }}
              >
                <div className="ct-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--ct-ink-3)', letterSpacing: '0.1em' }}>
                  {cell.label}
                </div>
                <div
                  className="mt-1.5 font-bold"
                  style={{
                    fontSize: cell.isText ? '16px' : '26px',
                    lineHeight: cell.isText ? '1.3' : '1',
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ct-ink)',
                  }}
                >
                  {cell.value}
                  {cell.unit && <span className="text-[12px] font-medium ml-[3px]" style={{ color: 'var(--ct-ink-3)' }}>{cell.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Meals grouped by date */}
      {grouped.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 rounded-2xl"
          style={{ border: '2px dashed var(--ct-line)', color: 'var(--ct-ink-3)' }}
        >
          <UtensilsCrossed className="w-10 h-10 mb-3" style={{ color: 'var(--ct-ink-4)' }} />
          <p className="text-sm">No meals found for this period</p>
        </div>
      ) : (
        grouped.map(([date, dateMeals]) => {
          const dayTotal = dateMeals.reduce(
            (sum, m) => sum + (m.total_calories || 0),
            0
          );
          const d = new Date(date + 'T00:00:00');
          return (
            <div key={date}>
              {/* Day header */}
              <div
                className="flex items-center justify-between pb-3.5 mb-3.5"
                style={{ borderBottom: '1px solid var(--ct-line)' }}
              >
                <div className="flex items-baseline gap-3.5">
                  <span
                    className="text-[36px] leading-none"
                    style={{
                      fontFamily: 'var(--font-serif, Georgia, serif)',
                      fontStyle: 'italic',
                      fontWeight: 400,
                      letterSpacing: '-0.02em',
                      color: 'var(--ct-ink)',
                    }}
                  >
                    {String(d.getDate()).padStart(2, '0')}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[18px] font-semibold" style={{ letterSpacing: '-0.01em', color: 'var(--ct-ink)' }}>
                      {d.toLocaleDateString('en-US', { weekday: 'long' })}
                    </span>
                    <span
                      className="ct-mono text-[11px] font-medium uppercase"
                      style={{ color: 'var(--ct-ink-3)', letterSpacing: '0.1em' }}
                    >
                      {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} {d.getDate()} · {dateMeals.length} MEALS
                    </span>
                  </div>
                </div>
                <div className="flex items-baseline gap-3.5">
                  {(() => {
                    const diff = dayTotal - calorieTarget;
                    const isUnder = diff <= 0;
                    return (
                      <span
                        className="ct-mono text-[11px] py-1 px-2 rounded-[6px]"
                        style={{
                          background: isUnder ? 'var(--ct-ember-soft)' : 'rgba(239,83,80,0.08)',
                          color: isUnder ? 'var(--ct-ember-deep)' : 'oklch(0.45 0.18 25)',
                        }}
                      >
                        {isUnder ? '−' : '+'}{Math.abs(diff).toLocaleString()} kcal · {isUnder ? 'under' : 'over'} target
                      </span>
                    );
                  })()}
                  <span
                    className="text-[24px] font-bold"
                    style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--ct-ink)' }}
                  >
                    {dayTotal.toLocaleString()}
                    <span className="text-[13px] font-medium ml-0.5" style={{ color: 'var(--ct-ink-3)' }}>kcal</span>
                  </span>
                </div>
              </div>

              {/* Meal cards */}
              <div className="space-y-2 mb-6">
                {dateMeals.map((meal) => {
                  const photoUrl = getPhotoUrl(meal);
                  const badge = mealTypeBadge[meal.meal_type] || { bg: 'rgba(14,15,12,0.06)', color: 'var(--ct-ink-3)' };
                  return (
                    <div
                      key={meal.id}
                      className="rounded-[14px] overflow-hidden transition-all"
                      style={{
                        background: 'var(--ct-surface)',
                        border: '1px solid var(--ct-line)',
                        boxShadow: 'var(--ct-shadow-1)',
                      }}
                    >
                      <button
                        onClick={() => toggleMeal(meal.id)}
                        className="w-full text-left transition-colors"
                        style={{ background: expandedMeal === meal.id ? 'var(--ct-surface-2)' : 'transparent' }}
                      >
                        <div
                          className="grid items-center gap-4 px-[18px] py-[14px]"
                          style={{ gridTemplateColumns: '56px 1fr auto auto' }}
                        >
                          {/* Time column */}
                          <div className="ct-mono text-right" style={{ lineHeight: 1.3 }}>
                            <span className="text-[15px] font-medium block" style={{ color: 'var(--ct-ink)' }}>
                              {(() => { const t = formatTime(meal.eaten_at); return t.time; })()}
                            </span>
                            <span className="text-[11px] font-medium" style={{ color: 'var(--ct-ink-3)' }}>
                              {(() => { const t = formatTime(meal.eaten_at); return t.period; })()}
                            </span>
                          </div>

                          {/* Content */}
                          <div>
                            <span
                              className="ct-mono text-[10.5px] font-medium uppercase inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] mb-1.5"
                              style={{ background: badge.bg, color: badge.color, letterSpacing: '0.08em' }}
                            >
                              {meal.meal_type}
                            </span>
                            {(meal.notes || (meal.item_names && meal.item_names.length > 0)) && (
                              <div className="text-[14.5px] font-medium truncate max-w-[400px]" style={{ color: 'var(--ct-ink)', letterSpacing: '-0.005em' }}>
                                {meal.notes || (
                                  <>
                                    {meal.item_names!.slice(0, 3).join(', ')}
                                    {meal.item_names!.length > 3 && (
                                      <span className="ct-mono text-[11px] ml-1.5 px-1.5 py-0.5 rounded" style={{ background: 'rgba(14,15,12,0.05)', color: 'var(--ct-ink-3)' }}>
                                        +{meal.item_names!.length - 3}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Calories */}
                          <div className="ct-mono text-[16px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ct-ink)' }}>
                            {meal.total_calories}
                            <span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--ct-ink-3)' }}>kcal</span>
                          </div>

                          {/* Toggle */}
                          <div
                            className="w-[30px] h-[30px] grid place-items-center rounded-lg"
                            style={{ background: 'var(--ct-surface-2)', border: '1px solid var(--ct-line)', color: 'var(--ct-ink-3)' }}
                          >
                            {expandedMeal === meal.id ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </div>
                        </div>
                      </button>

                      {expandedMeal === meal.id && (
                        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--ct-line)', background: 'var(--ct-surface-2)' }}>
                          {meal.notes && (
                            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--ct-ink)' }}>{meal.notes}</p>
                          )}
                          {/* Macro summary */}
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            {[
                              { label: 'Protein', value: Math.round(meal.total_protein_g || 0), unit: 'g', color: '#3b82f6' },
                              { label: 'Carbs', value: Math.round(meal.total_carbs_g || 0), unit: 'g', color: 'var(--ct-good)' },
                              { label: 'Fat', value: Math.round(meal.total_fat_g || 0), unit: 'g', color: '#a855f7' },
                              { label: 'Fiber', value: Math.round(meal.total_fiber_g || 0), unit: 'g', color: 'var(--ct-ink-3)' },
                            ].map((m) => (
                              <div key={m.label} className="text-center">
                                <div className="ct-mono text-[9px] font-medium uppercase" style={{ color: 'var(--ct-ink-4)', letterSpacing: '0.1em' }}>{m.label}</div>
                                <div className="ct-mono text-sm font-bold" style={{ color: m.color }}>{m.value}{m.unit}</div>
                              </div>
                            ))}
                          </div>

                          {mealItems[meal.id] ? (
                            <div>
                              {mealItems[meal.id].map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between py-2.5 text-sm"
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
                                    {item.calories} kcal
                                  </span>
                                </div>
                              ))}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingMeal(meal);
                                }}
                                className="flex items-center gap-1.5 mt-3 px-3 py-1.5 text-sm font-medium rounded-full transition-colors"
                                style={{ color: 'var(--ct-ember)', background: 'var(--ct-ember-soft)' }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit meal
                              </button>
                            </div>
                          ) : (
                            <Skeleton className="h-16" style={{ background: 'rgba(14,15,12,0.06)' }} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {showAddModal && (
        <AddMealModal
          onClose={() => setShowAddModal(false)}
          onAdded={fetchMeals}
        />
      )}
      {editingMeal && mealItems[editingMeal.id] && (
        <EditMealModal
          meal={editingMeal}
          items={mealItems[editingMeal.id]}
          onClose={() => setEditingMeal(null)}
          onSaved={() => {
            setMealItems((prev) => {
              const next = { ...prev };
              delete next[editingMeal.id];
              return next;
            });
            fetchMeals();
          }}
        />
      )}
      {lightboxUrl && (
        <PhotoLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  );
}
