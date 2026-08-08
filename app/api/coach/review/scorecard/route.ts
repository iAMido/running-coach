export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { buildScorecardForUser } from '@/lib/coach/weekly-scorecard';
import { nowInUserTz, shiftedDateStr } from '@/lib/utils/user-time';
import { getSundayOfWeek } from '@/lib/utils/week-calculator';

/**
 * This week's scorecard. Read by `/coach/review` before any AI call — it is
 * deterministic, so it costs nothing and is always consistent with the data.
 */
export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    // Sunday-to-Saturday in the athlete's timezone. The server runs UTC, so a
    // bare new Date() puts Sunday 00:00-03:00 Israel into the previous week.
    //
    // `shiftedDateStr`, not `userDateStr`: these Dates already carry user-tz
    // calendar fields, and converting again would shift them a second time.
    const sunday = getSundayOfWeek(nowInUserTz());
    const weekStart = shiftedDateStr(sunday);
    const saturday = new Date(sunday);
    saturday.setDate(saturday.getDate() + 6);
    const weekEnd = shiftedDateStr(saturday);

    return NextResponse.json({ scorecard: await buildScorecardForUser(auth.userId, weekStart, weekEnd) });
  } catch (error) {
    console.error('Error building scorecard:', error);
    return NextResponse.json({ error: 'Failed to build scorecard' }, { status: 500 });
  }
}
