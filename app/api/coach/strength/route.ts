import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getWeeklyStrength, getPhaseForWeek } from '@/lib/db/strength';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

/**
 * GET /api/coach/strength
 * Returns the weekly strength workout based on the user's current training plan phase
 *
 * Query params:
 * - week: Optional week number override
 * - totalWeeks: Optional total weeks override
 * - phase: Optional direct phase override (base, build, specific)
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const { searchParams } = new URL(request.url);

  try {
    // Check for direct phase override
    const phaseOverride = searchParams.get('phase') as 'base' | 'build' | 'specific' | null;

    let weekNumber: number;
    let totalWeeks: number;

    if (phaseOverride && ['base', 'build', 'specific'].includes(phaseOverride)) {
      // If phase is directly specified, use mock values that result in that phase
      weekNumber = phaseOverride === 'base' ? 1 : phaseOverride === 'build' ? 4 : 7;
      totalWeeks = 9;
    } else {
      // Get week from params or from user's active plan
      const weekParam = searchParams.get('week');
      const totalWeeksParam = searchParams.get('totalWeeks');

      if (weekParam && totalWeeksParam) {
        weekNumber = parseInt(weekParam, 10);
        totalWeeks = parseInt(totalWeeksParam, 10);
      } else {
        // Fetch from active plan
        const { data: plan, error } = await supabase
          .from('training_plans')
          .select('current_week_num, duration_weeks, start_date, created_at')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        if (!plan) {
          // No active plan - return base phase as default
          weekNumber = 1;
          totalWeeks = 8;
        } else {
          // Calculate actual current week from start date
          const startDate = plan.start_date || (plan.created_at ? plan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
          const start = new Date(startDate);
          const now = new Date();
          const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          weekNumber = Math.max(1, Math.min(plan.duration_weeks, Math.floor(diffDays / 7) + 1));
          totalWeeks = plan.duration_weeks;
        }
      }
    }

    // Get the strength workout for this week
    const strengthWorkout = await getWeeklyStrength(weekNumber, totalWeeks);

    if (!strengthWorkout) {
      return NextResponse.json(
        { error: 'Could not load strength workout' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      strength: strengthWorkout,
      weekNumber,
      totalWeeks,
      phase: strengthWorkout.phase,
    });
  } catch (error) {
    console.error('Error fetching strength workout:', error);
    return NextResponse.json(
      { error: 'Failed to fetch strength workout' },
      { status: 500 }
    );
  }
}
