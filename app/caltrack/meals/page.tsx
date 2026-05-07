'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronDown,
  ChevronUp,
  UtensilsCrossed,
  Plus,
  X,
  Search,
  ImageIcon,
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

interface FoodSearchResult {
  fdc_id: number;
  name: string;
  per100g: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
}

// ─── Add Meal Modal ───
function AddMealModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mealType, setMealType] = useState<string>('lunch');
  const [foodQuery, setFoodQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | null>(null);
  const [grams, setGrams] = useState('100');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const searchFoods = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/caltrack/foods/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setFoodQuery(val);
    setSelectedFood(null);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchFoods(val), 300);
  };

  const selectFood = (food: FoodSearchResult) => {
    setSelectedFood(food);
    setFoodQuery(food.name);
    setSearchResults([]);
  };

  const calculated = selectedFood
    ? {
        calories: Math.round((selectedFood.per100g.calories * Number(grams)) / 100),
        protein: Math.round(((selectedFood.per100g.protein * Number(grams)) / 100) * 10) / 10,
        carbs: Math.round(((selectedFood.per100g.carbs * Number(grams)) / 100) * 10) / 10,
        fat: Math.round(((selectedFood.per100g.fat * Number(grams)) / 100) * 10) / 10,
        fiber: Math.round(((selectedFood.per100g.fiber * Number(grams)) / 100) * 10) / 10,
      }
    : null;

  const handleSubmit = async () => {
    if (!selectedFood || !grams) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/caltrack/meals/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_type: mealType,
          food_name: selectedFood.name,
          weight_grams: Number(grams),
        }),
      });
      if (res.ok) {
        onAdded();
        onClose();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add meal');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
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
            <div className="flex gap-2">
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

          {/* Food search */}
          <div className="relative">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Food (search in English)
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="e.g. chicken breast, olive oil, rice..."
                value={foodQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((food) => (
                  <button
                    key={food.fdc_id}
                    onClick={() => selectFood(food)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 border-b border-border/50 last:border-0"
                  >
                    <span className="font-medium">{food.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {food.per100g.calories} kcal/100g
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Weight */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Weight (grams)
            </label>
            <input
              type="number"
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              min="1"
              max="5000"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            />
          </div>

          {/* Nutrition preview */}
          {calculated && (
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-sm font-medium mb-2">
                Nutrition for {grams}g {selectedFood?.name}
              </p>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Cal</p>
                  <p className="font-bold text-orange-600">{calculated.calories}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Protein</p>
                  <p className="font-bold text-blue-600">{calculated.protein}g</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Carbs</p>
                  <p className="font-bold text-green-600">{calculated.carbs}g</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fat</p>
                  <p className="font-bold text-purple-600">{calculated.fat}g</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fiber</p>
                  <p className="font-bold">{calculated.fiber}g</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!selectedFood || !grams || submitting}
            className="w-full py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Adding...' : 'Add Meal'}
          </button>
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
                          {/* Photo thumbnail */}
                          {photoUrl ? (
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
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-lg border border-border bg-muted/50 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
                            </div>
                          )}
                          <div>
                            <span
                              className={cn(
                                'text-xs font-medium px-2 py-0.5 rounded-full',
                                mealTypeColors[meal.meal_type] ||
                                  'bg-muted text-muted-foreground'
                              )}
                            >
                              {meal.meal_type}
                            </span>
                            <span className="text-sm text-muted-foreground ml-2">
                              {formatDateTime(meal.eaten_at)}
                            </span>
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
      {lightboxUrl && (
        <PhotoLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  );
}
