import { userDateStr } from '@/lib/utils/user-time';

/**
 * A plan's start date (YYYY-MM-DD) for week arithmetic: its `start_date`,
 * else the day it was created, else today in Israel. This fallback was copied
 * into five routes, and each used today's UTC date, which between 00:00 and
 * 03:00 Israel time is still yesterday (CLAUDE.md "Timezone rule").
 */
export function planStartDate(
  plan: { start_date?: string | null; created_at?: string | null },
  today: string = userDateStr(),
): string {
  return plan.start_date || (plan.created_at ? plan.created_at.split('T')[0] : today);
}
