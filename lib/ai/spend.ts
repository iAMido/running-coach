import { userDateStr } from '@/lib/utils/user-time';

/**
 * A daily AI spend cap per athlete (`runcoach.ai_spend_daily`, migration
 * 20261118_ai_spend.sql), 2026-11-18.
 *
 * It replaces the per-IP rate limiter in middleware.ts. That limiter was an
 * in-memory Map: each server instance counted on its own, every deploy reset
 * it, and the most expensive route (the plan builder, ~$3 a plan) fell under
 * its 100-a-minute default. What actually needs bounding is money, so the cap
 * counts dollars, from what the provider says each call cost.
 *
 * The cap is a safety net against a runaway loop or a stolen session, not a
 * budget to plan around. The heaviest real day measured so far (2026-11-06,
 * 7 plan builds) cost $9.65 in plan building; the default is ~2.5× that.
 * Override with AI_DAILY_CAP_USD.
 *
 * Fails OPEN: if the ledger cannot be read (database hiccup, migration not
 * applied), calls go ahead, as they did before the cap existed, with a warning.
 */
export const DEFAULT_DAILY_CAP_USD = 25;

export function dailyCapUsd(raw = process.env.AI_DAILY_CAP_USD): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP_USD;
}

/** Test seam: the ledger's two operations. */
export interface SpendBackend {
  /** Today's total so far, or null when it cannot be read. */
  spent(userId: string, day: string): Promise<number | null>;
  add(userId: string, day: string, usd: number): Promise<void>;
}

const supabaseBackend: SpendBackend = {
  async spent(userId, day) {
    // Imported lazily: openrouter.ts (and its tests and scripts) import this
    // module, and most of them never touch the ledger.
    const { supabase } = await import('@/lib/db/supabase');
    const { data, error } = await supabase
      .from('ai_spend_daily').select('usd').eq('user_id', userId).eq('day', day).maybeSingle();
    if (error) {
      console.warn(`AI spend ledger unreadable, not enforcing the cap: ${error.message}`);
      return null;
    }
    return data ? Number(data.usd) : 0;
  },
  async add(userId, day, usd) {
    const { supabase } = await import('@/lib/db/supabase');
    const { error } = await supabase.rpc('add_ai_spend', { p_user_id: userId, p_day: day, p_usd: usd });
    if (error) console.warn(`AI spend not recorded ($${usd.toFixed(4)}): ${error.message}`);
  },
};

export type SpendCheck = { allowed: true } | { allowed: false; spent: number; cap: number };

export async function checkSpend(
  userId: string,
  { backend = supabaseBackend, cap = dailyCapUsd(), day = userDateStr() }: { backend?: SpendBackend; cap?: number; day?: string } = {},
): Promise<SpendCheck> {
  const spent = await backend.spent(userId, day).catch(() => null);
  if (spent === null || spent < cap) return { allowed: true };
  return { allowed: false, spent, cap };
}

/** Best effort: a failed write never fails the call that was already paid for. */
export async function recordSpend(
  userId: string,
  usd: number | null | undefined,
  { backend = supabaseBackend, day = userDateStr() }: { backend?: SpendBackend; day?: string } = {},
): Promise<void> {
  await backend.add(userId, day, typeof usd === 'number' && usd > 0 ? usd : 0).catch(() => {});
}

export function overCapMessage(c: { spent: number; cap: number }): string {
  return `Today's AI budget is used up ($${c.spent.toFixed(2)} of $${c.cap.toFixed(2)}). It resets at midnight Israel time.`;
}
