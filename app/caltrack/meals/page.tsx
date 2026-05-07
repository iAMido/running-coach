'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, UtensilsCrossed } from 'lucide-react';
import type { CaltrackMeal, CaltrackMealItem } from '@/lib/db/caltrack-types';

type MealFilter = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'snack';

const mealTypeColors: Record<string, string> = {
  breakfast: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  lunch: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  dinner: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  snack: 'bg-green-500/10 text-green-700 dark:text-green-400',
};

export default function MealsPage() {
  const [meals, setMeals] = useState<CaltrackMeal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MealFilter>('all');
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const [mealItems, setMealItems] = useState<Record<string, CaltrackMealItem[]>>({});
  const [days, setDays] = useState(7);

  const fetchMeals = useCallback(async () => {
    setLoading(true);
    const from = new Date();
    from.setDate(from.getDate() - days);
    const params = new URLSearchParams({
      from: from.toISOString().split('T')[0],
      limit: '100',
    });
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
  }, [filter, days]);

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
            {total} meals in the last {days} days
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                days === d
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

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
              {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          )
        )}
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
                {dateMeals.map((meal) => (
                  <div
                    key={meal.id}
                    className="bg-card border border-border rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => toggleMeal(meal.id)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'text-xs font-medium px-2 py-1 rounded-full',
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
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
