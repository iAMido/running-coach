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

const mealTypeColors: Record<string, string> = {
  breakfast: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  lunch: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  dinner: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  snack: 'bg-green-500/10 text-green-700 dark:text-green-400',
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
  const [mealType, setMealType] = useState<string>('lunch');
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
      const res = await fetch('/api/caltrack/meals/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_type: mealType,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Add Meal</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Meal type */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Meal Type
            </label>
            <div className="flex gap-2 flex-wrap">
              {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-full border transition-all',
                    mealType === type
                      ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Free-text input */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              What did you eat? (Hebrew or English)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"פיתה שווארמה פרגית\nסושי סלמון רול\nchicken breast with rice and salad"}
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 resize-none"
              dir="auto"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Describe any dish — AI will break it down into ingredients
            </p>
          </div>

          {!analysis && (
            <button
              onClick={handleAnalyze}
              disabled={!description.trim() || analyzing}
              className="w-full py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {analyzing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
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
                  <p className="font-semibold">{analysis.dish_name_he}</p>
                  <p className="text-sm text-muted-foreground">{analysis.dish_name_en}</p>
                </div>
                <button
                  onClick={() => setAnalysis(null)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted"
                >
                  Re-analyze
                </button>
              </div>

              {/* Ingredients list — editable */}
              <div className="space-y-2">
                {analysis.ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="bg-muted/40 rounded-xl p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">{ing.name_he || ing.name_en}</span>
                        {ing.name_he && (
                          <span className="text-xs text-muted-foreground ml-1.5">
                            ({ing.name_en})
                          </span>
                        )}
                        <span
                          className={cn(
                            'text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full',
                            ing.source === 'usda'
                              ? 'bg-green-500/10 text-green-600'
                              : 'bg-blue-500/10 text-blue-600'
                          )}
                        >
                          {ing.source === 'usda' ? 'USDA' : 'AI'}
                        </span>
                      </div>
                      <button
                        onClick={() => removeIngredient(i)}
                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={ing.estimated_grams}
                        onChange={(e) =>
                          updateIngredientGrams(i, Math.max(1, Number(e.target.value)))
                        }
                        className="w-20 px-2 py-1 text-sm rounded-lg border border-border bg-background text-center"
                        min="1"
                      />
                      <span className="text-xs text-muted-foreground">g</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {ing.calculated.calories} kcal
                      </span>
                      <span className="text-xs text-muted-foreground">
                        P:{ing.calculated.protein}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        C:{ing.calculated.carbs}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        F:{ing.calculated.fat}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="bg-orange-500/5 rounded-xl p-3 border border-orange-500/10">
                <p className="text-sm font-semibold mb-2">Total</p>
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  <div>
                    <p className="text-muted-foreground">Cal</p>
                    <p className="font-bold text-orange-600 text-base">
                      {analysis.totals.calories}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Protein</p>
                    <p className="font-bold text-blue-600">{analysis.totals.protein}g</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Carbs</p>
                    <p className="font-bold text-green-600">{analysis.totals.carbs}g</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fat</p>
                    <p className="font-bold text-purple-600">{analysis.totals.fat}g</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fiber</p>
                    <p className="font-bold">{analysis.totals.fiber}g</p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleConfirm}
                disabled={submitting || !analysis.ingredients.length}
                className="w-full py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Saving...' : `Confirm & Save (${analysis.totals.calories} kcal)`}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Edit Meal</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Meal type selector */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Meal Type
            </label>
            <div className="flex gap-2">
              {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-full border transition-all',
                    mealType === type
                      ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Ingredients
            </label>
            <div className="space-y-2">
              {ingredients.map((ing, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ing.name_en}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={ing.grams}
                        onChange={(e) => updateIngredient(idx, 'grams', e.target.value)}
                        className="w-16 px-2 py-0.5 text-xs rounded border border-border bg-muted/50 text-center"
                      />
                      <span className="text-xs text-muted-foreground">g</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {ing.calories} kcal
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeIngredient(idx)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new ingredient */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                placeholder="Add ingredient (e.g. חומוס, rice)..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addIngredient()}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              />
              <button
                onClick={addIngredient}
                disabled={analyzing || !newName.trim()}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50"
              >
                {analyzing ? '...' : '+ Add'}
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs p-3 rounded-lg bg-muted/50">
            <div>
              <p className="text-muted-foreground">Calories</p>
              <p className="font-bold text-orange-600">{Math.round(totals.calories)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Protein</p>
              <p className="font-bold text-blue-600">{Math.round(totals.protein)}g</p>
            </div>
            <div>
              <p className="text-muted-foreground">Carbs</p>
              <p className="font-bold text-green-600">{Math.round(totals.carbs)}g</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fat</p>
              <p className="font-bold text-purple-600">{Math.round(totals.fat)}g</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fiber</p>
              <p className="font-bold">{Math.round(totals.fiber)}g</p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !ingredients.length}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : `Save Changes (${Math.round(totals.calories)} kcal)`}
            </button>
          </div>

          {/* Delete */}
          <div className="pt-2 border-t border-border">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-500">Delete this meal?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-500 transition-colors"
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

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-10 w-48" />
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-20" />
          ))}
        </div>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  const grouped = groupByDate(meals);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meals</h1>
          <p className="text-muted-foreground text-sm">
            {total} meals
            {customRange
              ? ` from ${customRange.from} to ${customRange.to}`
              : ` in the last ${days} days`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Meal
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Meal type filter */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'breakfast', 'lunch', 'dinner', 'snack'] as const).map(
            (type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-full border transition-all',
                  filter === type
                    ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                )}
              >
                {type === 'all'
                  ? 'All'
                  : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            )
          )}
        </div>

        <DateRangePicker
          selectedDays={days}
          onChange={(d) => {
            setDays(d);
            setCustomRange(undefined);
          }}
          customRange={customRange}
          onCustomRange={(from, to) => {
            setCustomRange({ from, to });
            setDays(-1);
          }}
        />
      </div>

      {/* Meals list grouped by date */}
      {grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <UtensilsCrossed className="w-10 h-10 mb-2 opacity-50" />
          <p>No meals found for this period</p>
        </div>
      ) : (
        grouped.map(([date, dateMeals]) => {
          const dayTotal = dateMeals.reduce(
            (sum, m) => sum + (m.total_calories || 0),
            0
          );
          return (
            <div key={date}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h3>
                <span className="text-sm font-medium">
                  {dayTotal.toLocaleString()} kcal
                </span>
              </div>
              <div className="space-y-2">
                {dateMeals.map((meal) => {
                  const photoUrl = getPhotoUrl(meal);
                  return (
                    <div
                      key={meal.id}
                      className="bg-card border border-border rounded-xl overflow-hidden"
                    >
                      <button
                        onClick={() => toggleMeal(meal.id)}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {photoUrl && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightboxUrl(photoUrl);
                              }}
                              className="w-10 h-10 rounded-lg overflow-hidden border border-border shrink-0 hover:ring-2 hover:ring-orange-500/30 transition-all"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photoUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                                }}
                              />
                            </button>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'text-xs font-medium px-2 py-0.5 rounded-full',
                                  mealTypeColors[meal.meal_type] ||
                                    'bg-muted text-muted-foreground'
                                )}
                              >
                                {meal.meal_type}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {formatDateTime(meal.eaten_at)}
                              </span>
                            </div>
                            {meal.item_names && meal.item_names.length > 0 && (
                              <p className="text-sm font-medium mt-0.5 truncate max-w-[250px] sm:max-w-[400px]">
                                {meal.item_names.slice(0, 3).join(', ')}
                                {meal.item_names.length > 3 && ` +${meal.item_names.length - 3}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">
                            {meal.total_calories} kcal
                          </span>
                          {expandedMeal === meal.id ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {expandedMeal === meal.id && (
                        <div className="border-t border-border px-4 py-3 bg-muted/30">
                          <div className="grid grid-cols-4 gap-2 mb-3 text-center text-xs">
                            <div>
                              <p className="text-muted-foreground">Protein</p>
                              <p className="font-medium">
                                {Math.round(meal.total_protein_g || 0)}g
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Carbs</p>
                              <p className="font-medium">
                                {Math.round(meal.total_carbs_g || 0)}g
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Fat</p>
                              <p className="font-medium">
                                {Math.round(meal.total_fat_g || 0)}g
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Fiber</p>
                              <p className="font-medium">
                                {Math.round(meal.total_fiber_g || 0)}g
                              </p>
                            </div>
                          </div>

                          {mealItems[meal.id] ? (
                            <div className="space-y-1">
                              {mealItems[meal.id].map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between py-1.5 text-sm border-b border-border/50 last:border-0"
                                >
                                  <div>
                                    <span className="font-medium">
                                      {item.ingredient_name}
                                    </span>
                                    <span className="text-muted-foreground ml-2">
                                      {item.weight_grams}g
                                    </span>
                                  </div>
                                  <span className="text-muted-foreground">
                                    {item.calories} kcal
                                  </span>
                                </div>
                              ))}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingMeal(meal);
                                }}
                                className="flex items-center gap-1.5 mt-2 px-3 py-1.5 text-sm font-medium rounded-lg text-orange-600 hover:bg-orange-500/10 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit meal
                              </button>
                            </div>
                          ) : (
                            <Skeleton className="h-16" />
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
