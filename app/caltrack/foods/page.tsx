'use client';

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Apple, Search, Star, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

interface FoodPer100g {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

interface FoodItem {
  ingredient_name: string;
  total_count: number;
  avg_calories: number;
  avg_weight: number;
  is_personal: boolean;
  personal_food_id: string | null;
  per_100g: FoodPer100g | null;
}

export default function FoodsPage() {
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'personal'>('all');
  const [expandedFood, setExpandedFood] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchFoods = useCallback(async () => {
    try {
      const res = await fetch('/api/caltrack/foods');
      if (res.ok) {
        const data = await res.json();
        setFoods(data.foods);
      }
    } catch (err) {
      console.error('Failed to fetch foods:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFoods();
  }, [fetchFoods]);

  const togglePersonalFood = async (food: FoodItem) => {
    setSaving(food.ingredient_name);
    try {
      if (food.is_personal && food.personal_food_id) {
        // Remove from personal foods
        await fetch(`/api/caltrack/foods?id=${food.personal_food_id}`, {
          method: 'DELETE',
        });
      } else {
        // Save as personal food with computed per-100g values
        await fetch('/api/caltrack/foods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredient_name: food.ingredient_name,
            calories_per_100g: food.per_100g?.calories,
            protein_per_100g: food.per_100g?.protein,
            carbs_per_100g: food.per_100g?.carbs,
            fat_per_100g: food.per_100g?.fat,
          }),
        });
      }
      await fetchFoods();
    } catch (err) {
      console.error('Failed to toggle personal food:', err);
    } finally {
      setSaving(null);
    }
  };

  let filtered = search
    ? foods.filter((f) =>
        f.ingredient_name.toLowerCase().includes(search.toLowerCase())
      )
    : foods;

  if (filter === 'personal') {
    filtered = filtered.filter((f) => f.is_personal);
  }

  const personalCount = foods.filter((f) => f.is_personal).length;

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-full" />
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Foods</h1>
        <p className="text-muted-foreground text-sm">
          {foods.length} unique foods
          {personalCount > 0 && ` · ${personalCount} saved to library`}
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search foods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
          />
        </div>
        <div className="flex rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-orange-500/10 text-orange-600'
                : 'bg-background text-muted-foreground hover:bg-muted/50'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('personal')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-l border-border ${
              filter === 'personal'
                ? 'bg-orange-500/10 text-orange-600'
                : 'bg-background text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Star className="w-3.5 h-3.5 inline mr-1" />
            Saved ({personalCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Apple className="w-10 h-10 mb-2 opacity-50" />
          <p>
            {search
              ? 'No foods match your search'
              : filter === 'personal'
                ? 'No saved foods yet. Star a food to save it!'
                : 'No food data yet'}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_70px_80px_40px] gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/50">
            <span>Food</span>
            <span className="text-center">Times</span>
            <span className="text-center">Avg Wt</span>
            <span className="text-center">Avg Cal</span>
            <span />
          </div>
          {filtered.map((food) => (
            <div key={food.ingredient_name}>
              <div
                className="grid grid-cols-[1fr_60px_70px_80px_40px] gap-2 px-4 py-3 text-sm border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() =>
                  setExpandedFood(
                    expandedFood === food.ingredient_name
                      ? null
                      : food.ingredient_name
                  )
                }
              >
                <span className="font-medium truncate flex items-center gap-1.5">
                  {food.is_personal && (
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  )}
                  {food.ingredient_name}
                </span>
                <span className="text-center text-muted-foreground">
                  {food.total_count}x
                </span>
                <span className="text-center text-muted-foreground">
                  {food.avg_weight}g
                </span>
                <span className="text-center font-medium">
                  {food.avg_calories} kcal
                </span>
                <span className="text-center text-muted-foreground">
                  {expandedFood === food.ingredient_name ? (
                    <ChevronUp className="w-4 h-4 inline" />
                  ) : (
                    <ChevronDown className="w-4 h-4 inline" />
                  )}
                </span>
              </div>

              {/* Expanded Detail */}
              {expandedFood === food.ingredient_name && (
                <div className="px-4 py-3 bg-muted/20 border-b border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">
                      Per 100g Nutrition
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePersonalFood(food);
                        }}
                        disabled={saving === food.ingredient_name}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          food.is_personal
                            ? 'bg-red-500/10 text-red-600 hover:bg-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20'
                        }`}
                      >
                        {food.is_personal ? (
                          <>
                            <Trash2 className="w-3 h-3" />
                            {saving === food.ingredient_name
                              ? 'Removing...'
                              : 'Remove'}
                          </>
                        ) : (
                          <>
                            <Star className="w-3 h-3" />
                            {saving === food.ingredient_name
                              ? 'Saving...'
                              : 'Save to Library'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {food.per_100g ? (
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-orange-500/5 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Calories
                        </p>
                        <p className="text-sm font-bold text-orange-600">
                          {food.per_100g.calories ?? '—'}
                        </p>
                      </div>
                      <div className="bg-blue-500/5 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Protein
                        </p>
                        <p className="text-sm font-bold text-blue-600">
                          {food.per_100g.protein ?? '—'}g
                        </p>
                      </div>
                      <div className="bg-green-500/5 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Carbs
                        </p>
                        <p className="text-sm font-bold text-green-600">
                          {food.per_100g.carbs ?? '—'}g
                        </p>
                      </div>
                      <div className="bg-purple-500/5 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Fat
                        </p>
                        <p className="text-sm font-bold text-purple-600">
                          {food.per_100g.fat ?? '—'}g
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No per-100g data available
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
