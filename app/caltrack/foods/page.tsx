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
        await fetch(`/api/caltrack/foods?id=${food.personal_food_id}`, {
          method: 'DELETE',
        });
      } else {
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

  // Find max calories for density bars
  const maxCal = Math.max(...filtered.map((f) => f.avg_calories), 1);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <Skeleton className="h-10 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-14" style={{ background: 'rgba(14,15,12,0.06)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="ct-kicker mb-2">
          <span
            className="inline-block w-[6px] h-[6px] rounded-full mr-2"
            style={{ background: 'var(--ct-ember)' }}
          />
          NUTRITION DATABASE
        </div>
        <h1
          className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
          style={{ letterSpacing: '-0.03em', color: 'var(--ct-ink)' }}
        >
          My Foods <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--ct-ink-2)' }}>library.</span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ct-ink-3)' }}>
          {foods.length} unique foods
          {personalCount > 0 && ` · ${personalCount} saved to library`}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ct-ink-4)' }} />
          <input
            type="text"
            placeholder="Search foods…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-full text-sm focus:outline-none focus:ring-2"
            style={{
              background: 'var(--ct-surface)',
              border: '1px solid var(--ct-line)',
              color: 'var(--ct-ink)',
              boxShadow: 'var(--ct-shadow-1)',
            }}
          />
        </div>
        <div
          className="inline-flex gap-[1px] rounded-full p-[3px] self-start"
          style={{
            background: 'var(--ct-surface)',
            border: '1px solid var(--ct-line)',
            boxShadow: 'var(--ct-shadow-1)',
          }}
        >
          <button
            onClick={() => setFilter('all')}
            className="ct-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors"
            style={{
              background: filter === 'all' ? 'var(--ct-ink)' : 'transparent',
              color: filter === 'all' ? '#fff' : 'var(--ct-ink-3)',
              letterSpacing: '0.06em',
            }}
          >
            ALL
          </button>
          <button
            onClick={() => setFilter('personal')}
            className="ct-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors flex items-center gap-1"
            style={{
              background: filter === 'personal' ? 'var(--ct-ink)' : 'transparent',
              color: filter === 'personal' ? '#fff' : 'var(--ct-ink-3)',
              letterSpacing: '0.06em',
            }}
          >
            <Star className="w-3 h-3" />
            SAVED ({personalCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 rounded-2xl"
          style={{ border: '2px dashed var(--ct-line)', color: 'var(--ct-ink-3)' }}
        >
          <Apple className="w-10 h-10 mb-3" style={{ color: 'var(--ct-ink-4)' }} />
          <p className="text-sm">
            {search
              ? 'No foods match your search'
              : filter === 'personal'
                ? 'No saved foods yet. Star a food to save it!'
                : 'No food data yet'}
          </p>
        </div>
      ) : (
        <div className="ct-card overflow-hidden p-0">
          {/* Table Header */}
          <div
            className="grid grid-cols-[1fr_55px_65px_90px_32px] gap-2 px-5 py-3 text-[10px] font-medium ct-mono uppercase"
            style={{
              color: 'var(--ct-ink-4)',
              letterSpacing: '0.1em',
              borderBottom: '1px solid var(--ct-line)',
              background: 'var(--ct-surface-2)',
            }}
          >
            <span>FOOD</span>
            <span className="text-center">COUNT</span>
            <span className="text-center">AVG WT</span>
            <span className="text-center">AVG CAL</span>
            <span />
          </div>

          {/* Rows */}
          {filtered.map((food, idx) => (
            <div key={food.ingredient_name}>
              <div
                className="grid grid-cols-[1fr_55px_65px_90px_32px] gap-2 px-5 py-3.5 text-sm transition-colors cursor-pointer"
                style={{
                  borderBottom: idx < filtered.length - 1 || expandedFood === food.ingredient_name
                    ? '1px solid var(--ct-line)'
                    : 'none',
                  background: expandedFood === food.ingredient_name ? 'var(--ct-surface-2)' : 'transparent',
                }}
                onClick={() =>
                  setExpandedFood(
                    expandedFood === food.ingredient_name ? null : food.ingredient_name
                  )
                }
              >
                <span className="font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--ct-ink)' }}>
                  {food.is_personal && (
                    <Star className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--ct-ember)', fill: 'var(--ct-ember)' }} />
                  )}
                  {food.ingredient_name}
                </span>
                <span className="text-center ct-mono text-xs" style={{ color: 'var(--ct-ink-3)' }}>
                  {food.total_count}×
                </span>
                <span className="text-center ct-mono text-xs" style={{ color: 'var(--ct-ink-3)' }}>
                  {food.avg_weight}g
                </span>
                <span className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className="ct-mono text-xs font-bold" style={{ color: 'var(--ct-ink)' }}>
                      {food.avg_calories}
                    </span>
                    {/* Density bar */}
                    <div
                      className="w-full h-[3px] rounded-full overflow-hidden"
                      style={{ background: 'rgba(14,15,12,0.06)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(food.avg_calories / maxCal) * 100}%`,
                          background: 'var(--ct-ember)',
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                </span>
                <span className="text-center grid place-items-center" style={{ color: 'var(--ct-ink-4)' }}>
                  {expandedFood === food.ingredient_name ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </span>
              </div>

              {/* Expanded Detail */}
              {expandedFood === food.ingredient_name && (
                <div
                  className="px-5 py-4"
                  style={{
                    background: 'var(--ct-surface-2)',
                    borderBottom: '1px solid var(--ct-line)',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="ct-kicker">PER 100G</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePersonalFood(food);
                      }}
                      disabled={saving === food.ingredient_name}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                      style={{
                        background: food.is_personal ? 'rgba(239,83,80,0.1)' : 'var(--ct-ember-soft)',
                        color: food.is_personal ? 'var(--ct-bad)' : 'var(--ct-ember)',
                      }}
                    >
                      {food.is_personal ? (
                        <>
                          <Trash2 className="w-3 h-3" />
                          {saving === food.ingredient_name ? 'Removing…' : 'Remove'}
                        </>
                      ) : (
                        <>
                          <Star className="w-3 h-3" />
                          {saving === food.ingredient_name ? 'Saving…' : 'Save to Library'}
                        </>
                      )}
                    </button>
                  </div>
                  {food.per_100g ? (
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'CALORIES', value: food.per_100g.calories, unit: '', color: 'var(--ct-ember)' },
                        { label: 'PROTEIN', value: food.per_100g.protein, unit: 'g', color: '#3b82f6' },
                        { label: 'CARBS', value: food.per_100g.carbs, unit: 'g', color: 'var(--ct-good)' },
                        { label: 'FAT', value: food.per_100g.fat, unit: 'g', color: '#a855f7' },
                      ].map((m) => (
                        <div
                          key={m.label}
                          className="rounded-xl p-3 text-center"
                          style={{
                            background: 'var(--ct-surface)',
                            border: '1px solid var(--ct-line)',
                          }}
                        >
                          <div
                            className="ct-mono text-[9px] font-medium uppercase mb-1.5"
                            style={{ color: 'var(--ct-ink-4)', letterSpacing: '0.1em' }}
                          >
                            {m.label}
                          </div>
                          <div
                            className="ct-mono text-lg font-bold"
                            style={{ color: m.color }}
                          >
                            {m.value ?? '—'}
                            {m.value !== null && (
                              <span className="text-xs font-medium" style={{ color: 'var(--ct-ink-3)' }}>
                                {m.unit}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--ct-ink-3)' }}>
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
