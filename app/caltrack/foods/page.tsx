'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Apple, Search } from 'lucide-react';

interface FoodFrequency {
  ingredient_name: string;
  total_count: number;
  avg_calories: number;
  avg_weight: number;
}

export default function FoodsPage() {
  const [foods, setFoods] = useState<FoodFrequency[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchFoods() {
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
    }
    fetchFoods();
  }, []);

  const filtered = search
    ? foods.filter((f) =>
        f.ingredient_name.toLowerCase().includes(search.toLowerCase())
      )
    : foods;

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
          {foods.length} unique foods you&apos;ve eaten — sorted by frequency
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search foods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Apple className="w-10 h-10 mb-2 opacity-50" />
          <p>{search ? 'No foods match your search' : 'No food data yet'}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-4 gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/50">
            <span className="col-span-1">Food</span>
            <span className="text-center">Times</span>
            <span className="text-center">Avg Weight</span>
            <span className="text-center">Avg Cal</span>
          </div>
          {filtered.map((food, i) => (
            <div
              key={i}
              className="grid grid-cols-4 gap-2 px-4 py-3 text-sm border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
            >
              <span className="col-span-1 font-medium truncate">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
