export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { getActivePlan } from '@/lib/db/plans';
import { getAthleteProfile } from '@/lib/db/profile';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { getIntervalsClientForUser } from '@/lib/intervals/sync';
import { previewWeek, pushWeek, WATCH_HORIZON_DAYS } from '@/lib/intervals/push-week';
import { IntervalsApiError } from '@/lib/intervals/client';
import { pushWeekSchema, validateInput } from '@/lib/validation/schemas';
import type { PlanWeek } from '@/lib/db/types';

/**
 * Preview or push one plan week to the athlete's intervals.icu calendar.
 *
 * `preview: true` translates and returns rows without writing — this lands on
 * the athlete's wrist, so the last chance to catch a mapping error is before it
 * becomes a session he runs.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userId = auth.userId;

  try {
    const body = await request.json().catch(() => ({}));
    const validation = validateInput(pushWeekSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { weekNumber, preview } = validation.data;

    const [plan, profile] = await Promise.all([getActivePlan(userId), getAthleteProfile(userId)]);
    if (!plan) return NextResponse.json({ error: 'No active training plan' }, { status: 400 });
    if (!plan.start_date) {
      return NextResponse.json({ error: 'Plan has no start date, so week dates cannot be resolved' }, { status: 400 });
    }
    if (!profile?.max_hr) {
      return NextResponse.json({ error: 'Athlete profile has no max HR — workout targets are percentages of it' }, { status: 400 });
    }

    const week = (plan.plan_json?.weeks ?? []).find((w: PlanWeek) => w.week_number === weekNumber);
    if (!week) return NextResponse.json({ error: `Plan has no week ${weekNumber}` }, { status: 400 });

    // Only the current and next week are offered: everything beyond the sync
    // horizon is invisible on the watch anyway.
    const current = calculateCurrentWeek(plan.start_date, plan.duration_weeks).currentWeek;
    if (weekNumber < current || weekNumber > current + 1) {
      return NextResponse.json(
        { error: `Only week ${current} or ${current + 1} can be pushed — later weeks would not reach the watch yet.` },
        { status: 400 },
      );
    }

    const connection = await getIntervalsClientForUser(userId);
    if (!connection) return NextResponse.json({ error: 'intervals.icu not connected' }, { status: 400 });

    const bands = parseZonesFromProfile(profile);
    const today = userDateStr();

    if (preview) {
      return NextResponse.json({
        preview: true,
        weekNumber,
        maxHr: profile.max_hr,
        horizonDays: WATCH_HORIZON_DAYS,
        rows: previewWeek(plan, week, weekNumber, bands, profile.max_hr, today),
      });
    }

    // HARD REFUSAL. Pushed workouts are percentages that intervals.icu resolves
    // against THEIR max HR. If it disagrees with ours, every workout would mean
    // a different bpm range than the plan intends — silently. The sync-time
    // warning is the early alarm; this is the gate.
    const theirMaxHr = await connection.client.getAthleteMaxHr(userDateStrDaysAgo(60), today);
    if (theirMaxHr !== null && theirMaxHr !== profile.max_hr) {
      return NextResponse.json(
        {
          error:
            `Refusing to push: intervals.icu has max HR ${theirMaxHr}, this app has ${profile.max_hr}. ` +
            `Workout targets are percentages resolved against their number, so every session would land on a ` +
            `different heart-rate range than planned. Reconcile the two first.`,
        },
        { status: 409 },
      );
    }

    const result = await pushWeek(connection.client, plan, week, weekNumber, bands, profile.max_hr, today);
    return NextResponse.json({ preview: false, weekNumber, horizonDays: WATCH_HORIZON_DAYS, ...result });
  } catch (error) {
    if (error instanceof IntervalsApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('Error pushing week to intervals.icu:', error);
    const message = error instanceof Error ? error.message : 'Failed to push week';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
