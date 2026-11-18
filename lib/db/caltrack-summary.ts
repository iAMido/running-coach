import { caltrackDb } from '@/lib/db/supabase-caltrack';
import { israelDateFromIso } from '@/lib/db/caltrack-date';

/**
 * Recompute one Israel-local day's `daily_summary` row from its confirmed
 * meals (2026-11-18). The add, edit and delete routes each carried a copy of
 * this, and each copy loaded EVERY confirmed meal the athlete had ever logged
 * just to total one day.
 *
 * The query is bounded to a 48 h window around the day (Israel is UTC+2/+3,
 * so the day always falls inside it) and the exact Israel-date filter runs in
 * code, as before.
 */

export interface MealTotals {
  total_calories: number | null;
  total_protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  total_fiber_g: number | null;
  eaten_at: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The day's totals from any set of meals; meals on other Israel dates are ignored. Pure. */
export function sumDay(meals: MealTotals[], date: string) {
  const sameDay = meals.filter((m) => israelDateFromIso(m.eaten_at) === date);
  const t = sameDay.reduce(
    (acc, m) => ({
      cal: acc.cal + (m.total_calories || 0),
      pro: acc.pro + (m.total_protein_g || 0),
      carb: acc.carb + (m.total_carbs_g || 0),
      fat: acc.fat + (m.total_fat_g || 0),
      fib: acc.fib + (m.total_fiber_g || 0),
    }),
    { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 },
  );
  return {
    total_calories_in: t.cal,
    total_protein_g: round1(t.pro),
    total_carbs_g: round1(t.carb),
    total_fat_g: round1(t.fat),
    total_fiber_g: round1(t.fib),
    meal_count: sameDay.length,
  };
}

/** UTC bounds that always contain the Israel-local day `date` (YYYY-MM-DD). Pure. */
export function dayWindow(date: string): { from: string; to: string } {
  const noon = Date.parse(`${date}T12:00:00Z`);
  return {
    from: new Date(noon - 24 * 3_600_000).toISOString(),
    to: new Date(noon + 24 * 3_600_000).toISOString(),
  };
}

export async function refreshDailySummary(userId: string, date: string, targetCalories: number | null | undefined): Promise<void> {
  const { from, to } = dayWindow(date);
  const { data, error } = await caltrackDb
    .from('meals')
    .select('total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,eaten_at')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .gte('eaten_at', from)
    .lt('eaten_at', to);
  if (error || !data) return;
  await caltrackDb.from('daily_summary').upsert(
    {
      user_id: userId,
      date,
      ...sumDay(data as MealTotals[], date),
      target_calories: targetCalories || 2000,
      // net_calories intentionally not written here — the coach derives net
      // from caltrack_runs at read time. Writing it from calories_in alone
      // caused inconsistencies.
    },
    { onConflict: 'user_id,date' },
  );
}
