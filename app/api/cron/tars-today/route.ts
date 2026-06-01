/**
 * GET /api/cron/tars-today
 *
 * Read-only endpoint consumed by TARS (the user's personal agent) for the
 * morning briefing. Returns today's training prescription and a thin
 * summary of this week's plan for context.
 *
 * Auth: `Authorization: Bearer ${TARS_API_KEY}` — DEDICATED secret for TARS,
 * intentionally separate from CRON_SECRET (so a leak in either does not
 * compromise the other) and from NEXTAUTH_SECRET (which signs session JWTs
 * and must never be reused for API auth).
 * No session/cookie — TARS calls server-to-server.
 *
 * Query params:
 *   user_id  required — the Supabase auth user id whose plan to fetch.
 *
 * Response shape:
 *   {
 *     date: "2026-06-02",
 *     day_of_week: "Tuesday",
 *     has_plan: true,
 *     plan: { type, current_week, total_weeks, week_date_range },
 *     today: { type, distance_km, duration_min, description, paces, notes },
 *     week_outline: [ { day, type, distance_km } x 7 ],
 *   }
 *
 * Returns has_plan=false (200) when the user has no active plan — TARS just
 * omits the *Training* section in that case.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { calculateCurrentWeek, formatWeekDateRange } from '@/lib/utils/week-calculator';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export async function GET(request: NextRequest) {
  // --- auth ---
  // Use a TARS-dedicated secret. We deliberately do NOT fall back to
  // CRON_SECRET so that compromising one doesn't compromise the other.
  const authHeader = request.headers.get('authorization');
  const expected = process.env.TARS_API_KEY;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- user_id ---
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json(
      { error: 'user_id query param required' },
      { status: 400 },
    );
  }

  try {
    // --- fetch active plan ---
    const { data: plan, error } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    const todayDate = new Date();
    const dayName = DAYS[todayDate.getDay()];
    const dateIso = todayDate.toISOString().split('T')[0];

    if (!plan) {
      return NextResponse.json({
        date: dateIso,
        day_of_week: dayName,
        has_plan: false,
      });
    }

    // --- compute current week ---
    const startDate =
      plan.start_date ||
      (plan.created_at ? plan.created_at.split('T')[0] : dateIso);
    const weekInfo = calculateCurrentWeek(startDate, plan.duration_weeks);

    // plan_json is the AI-generated structure. Best-effort extraction:
    // both old and new shapes have plan.weeks[weekIdx].workouts as either
    // an array (Sun-Sat in order) or a dict keyed by day name.
    const planJson = plan.plan_json || {};
    const weeks = planJson.weeks || planJson.weekly_schedule || [];
    const weekIdx = Math.max(0, Math.min(weekInfo.currentWeek - 1, weeks.length - 1));
    const week = weeks[weekIdx] || null;

    let todayWorkout: unknown = null;
    let weekOutline: Array<{ day: string; summary: string }> = [];

    if (week) {
      const workouts = week.workouts || {};
      if (Array.isArray(workouts)) {
        // Array shape — index by getDay() (0=Sun..6=Sat)
        todayWorkout = workouts[todayDate.getDay()] ?? null;
        weekOutline = workouts.map((w, i) => ({
          day: DAYS[i],
          summary: summarizeWorkout(w),
        }));
      } else if (typeof workouts === 'object' && workouts !== null) {
        // Dict shape keyed by day name
        const dict = workouts as Record<string, unknown>;
        todayWorkout =
          dict[dayName] ??
          dict[dayName.toLowerCase()] ??
          null;
        weekOutline = DAYS.map((d) => ({
          day: d,
          summary: summarizeWorkout(dict[d] ?? dict[d.toLowerCase()]),
        }));
      }
    }

    return NextResponse.json({
      date: dateIso,
      day_of_week: dayName,
      has_plan: true,
      plan: {
        type: plan.plan_type,
        current_week: weekInfo.currentWeek,
        total_weeks: plan.duration_weeks,
        week_date_range: formatWeekDateRange(
          weekInfo.weekStartDate,
          weekInfo.weekEndDate,
        ),
        is_before_start: weekInfo.isBeforeStart,
        is_after_end: weekInfo.isAfterEnd,
      },
      today: todayWorkout,
      week_outline: weekOutline,
    });
  } catch (err) {
    console.error('tars-today error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch today plan', detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * One-line summary of an arbitrary workout object. Falls back to
 * stringified JSON if shape is unknown — TARS still benefits from the
 * raw text.
 */
function summarizeWorkout(w: unknown): string {
  if (!w) return 'rest';
  if (typeof w === 'string') return w;
  if (typeof w !== 'object') return String(w);
  const o = w as Record<string, unknown>;
  const type = o.type || o.workout_type || '';
  const distance = o.distance_km ?? o.distance;
  const duration = o.duration_min ?? o.duration;
  const description = o.description || o.notes || '';
  const bits: string[] = [];
  if (type) bits.push(String(type));
  // distance/duration may already include the unit (e.g. "6 km") or be a
  // bare number (e.g. 6). Only append the unit when it's a bare number.
  if (distance != null && distance !== '') {
    bits.push(typeof distance === 'number' ? `${distance}km` : String(distance));
  } else if (duration != null && duration !== '') {
    bits.push(typeof duration === 'number' ? `${duration}min` : String(duration));
  }
  if (description) bits.push(String(description).slice(0, 80));
  return bits.length ? bits.join(' · ') : JSON.stringify(o).slice(0, 120);
}
