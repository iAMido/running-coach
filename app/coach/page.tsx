'use client';

import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Activity, Timer, TrendingUp, Calendar, CheckCircle2, Flame, Target, Zap, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats, Run, TrainingPlan, PlanWeek, Workout } from '@/lib/db/types';
import { isWorkoutToday, getTodayDayName } from '@/lib/utils/week-calculator';

type StatVariant = 'runs' | 'distance' | 'weekly' | 'plan';

function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
  variant = 'runs',
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  loading?: boolean;
  variant?: StatVariant;
}) {
  const variantClasses = {
    runs: 'stat-card-runs',
    distance: 'stat-card-distance',
    weekly: 'stat-card-weekly',
    plan: 'stat-card-plan',
  };

  const iconClasses = {
    runs: 'stat-icon-runs',
    distance: 'stat-icon-distance',
    weekly: 'stat-icon-weekly',
    plan: 'stat-icon-plan',
  };

  return (
    <Card className={`coach-card stat-card stat-card-sparkline ${variantClasses[variant]}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="metric-label">
          {title}
        </CardTitle>
        <div className={`p-2.5 rounded-xl ${iconClasses[variant]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 w-24 skeleton-shimmer" />
        ) : (
          <>
            <div className="metric-value text-3xl font-bold">{value}</div>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoachDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, runsRes, planRes] = await Promise.all([
          fetch('/api/coach/stats'),
          fetch('/api/coach/runs?days=14&limit=10'),
          fetch('/api/coach/plans'),
        ]);

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        if (runsRes.ok) {
          const runsData = await runsRes.json();
          setRecentRuns(runsData.runs || []);
        }

        if (planRes.ok) {
          const planData = await planRes.json();
          setActivePlan(planData.plan || null);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setStats({
          totalRuns: 0,
          totalDistanceKm: 0,
          thisWeekKm: 0,
          thisWeekRuns: 0,
          activePlan: null,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Get current week workouts from the plan
  const getCurrentWeekWorkouts = (): Record<string, Workout> | null => {
    if (!activePlan?.plan_json) return null;

    const planJson = activePlan.plan_json;
    const currentWeekNum = activePlan.current_week_num || 1;

    // Find workouts from the weeks array
    if (planJson.weeks && Array.isArray(planJson.weeks)) {
      const currentWeek = planJson.weeks.find((w: PlanWeek) => w.week_number === currentWeekNum);
      if (currentWeek?.workouts) {
        return currentWeek.workouts;
      }
    }

    // Fallback to current_week field
    if (planJson.current_week) {
      const cw = planJson.current_week;
      if (cw.workouts) {
        return cw.workouts;
      }
      // Check if current_week itself contains workouts directly
      const firstVal = Object.values(cw)[0];
      if (firstVal && typeof firstVal === 'object' && ('type' in firstVal || 'duration' in firstVal)) {
        return cw as unknown as Record<string, Workout>;
      }
    }

    return null;
  };

  const getCurrentWeekInfo = (): { phase: string; focus: string } | null => {
    if (!activePlan?.plan_json?.weeks) return null;

    const currentWeekNum = activePlan.current_week_num || 1;
    const currentWeek = activePlan.plan_json.weeks.find((w: PlanWeek) => w.week_number === currentWeekNum);

    if (currentWeek) {
      return { phase: currentWeek.phase || '', focus: currentWeek.focus || '' };
    }
    return null;
  };

  const currentWeekWorkouts = getCurrentWeekWorkouts();
  const currentWeekInfo = getCurrentWeekInfo();

  // Get today's workout
  const getTodaysWorkout = (): { day: string; workout: Workout } | null => {
    if (!currentWeekWorkouts) return null;
    const todayName = getTodayDayName();
    for (const [day, workout] of Object.entries(currentWeekWorkouts)) {
      if (day.toLowerCase() === todayName.toLowerCase()) {
        return { day, workout: workout as Workout };
      }
    }
    return null;
  };

  const todaysWorkout = getTodaysWorkout();

  // Calculate plan progress percentage
  const getPlanProgress = (): number => {
    if (!activePlan) return 0;
    const currentWeek = activePlan.current_week_num || 1;
    const totalWeeks = activePlan.duration_weeks || 1;
    return Math.round((currentWeek / totalWeeks) * 100);
  };

  const planProgress = getPlanProgress();

  // Get motivational message based on workout type
  const getMotivationalMessage = (workout: Workout | null): string => {
    if (!workout) return "Rest day - recovery is part of training!";
    const type = workout.type?.toLowerCase() || '';
    if (type.includes('rest') || type.includes('off')) return "Rest day - recovery is part of training!";
    if (type.includes('easy')) return "Keep it easy, build that aerobic base!";
    if (type.includes('long')) return "Long run day - embrace the miles!";
    if (type.includes('tempo') || type.includes('threshold')) return "Time to push the pace!";
    if (type.includes('interval') || type.includes('speed')) return "Speed work - make it count!";
    return "Let's get after it today!";
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="coach-heading text-2xl md:text-3xl tracking-tight">
          Welcome back, {session?.user?.name?.split(' ')[0] || 'Coach'}
        </h1>
        <p className="text-muted-foreground mt-1 md:mt-2 text-sm md:text-base">
          Here&apos;s your training overview for today.
        </p>
      </div>

      {/* Today's Workout Hero Card */}
      {!loading && (
        <Card className="today-hero-card overflow-hidden border-0">
          <div className="relative">
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-secondary opacity-95" />

            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

            <CardContent className="relative p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                {/* Left side - Today's workout info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-white/20 text-white border-0 text-xs font-medium pulse-badge">
                      <Flame className="w-3 h-3 mr-1" />
                      TODAY
                    </Badge>
                    <span className="text-white/70 text-sm">{getTodayDayName()}</span>
                  </div>

                  {todaysWorkout ? (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">
                        {todaysWorkout.workout.type}
                      </h2>
                      <div className="flex items-center gap-4 text-white/90 mb-3">
                        {todaysWorkout.workout.distance && (
                          <span className="flex items-center gap-1">
                            <Target className="w-4 h-4" />
                            {todaysWorkout.workout.distance}
                          </span>
                        )}
                        {todaysWorkout.workout.duration && (
                          <span className="flex items-center gap-1">
                            <Timer className="w-4 h-4" />
                            {todaysWorkout.workout.duration}
                          </span>
                        )}
                        {todaysWorkout.workout.target_pace && (
                          <span className="flex items-center gap-1">
                            <Zap className="w-4 h-4" />
                            {todaysWorkout.workout.target_pace}
                          </span>
                        )}
                      </div>
                      <p className="text-white/80 text-sm italic">
                        {getMotivationalMessage(todaysWorkout.workout)}
                      </p>
                    </>
                  ) : activePlan ? (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">
                        Rest Day
                      </h2>
                      <p className="text-white/80 text-sm italic">
                        {getMotivationalMessage(null)}
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">
                        No Plan Active
                      </h2>
                      <p className="text-white/80 text-sm">
                        Generate a training plan to get started
                      </p>
                    </>
                  )}
                </div>

                {/* Right side - Action button & progress */}
                <div className="flex flex-col items-start md:items-end gap-3">
                  {todaysWorkout && todaysWorkout.workout.type?.toLowerCase() !== 'rest' && (
                    <Link href="/coach/log">
                      <Button className="bg-white text-primary hover:bg-white/90 font-semibold shadow-lg">
                        <Play className="w-4 h-4 mr-2" />
                        Log This Run
                      </Button>
                    </Link>
                  )}

                  {!activePlan && (
                    <Link href="/coach/plan">
                      <Button className="bg-white text-primary hover:bg-white/90 font-semibold shadow-lg">
                        <Target className="w-4 h-4 mr-2" />
                        Create Plan
                      </Button>
                    </Link>
                  )}

                  {/* Plan Progress */}
                  {activePlan && (
                    <div className="w-full md:w-48">
                      <div className="flex items-center justify-between text-white/80 text-xs mb-1">
                        <span>Plan Progress</span>
                        <span className="font-semibold">{planProgress}%</span>
                      </div>
                      <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white rounded-full transition-all duration-500"
                          style={{ width: `${planProgress}%` }}
                        />
                      </div>
                      <p className="text-white/60 text-xs mt-1">
                        Week {activePlan.current_week_num} of {activePlan.duration_weeks}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </div>
        </Card>
      )}

      {loading && (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}

      {/* Stats Grid */}
      <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Runs"
          value={stats?.totalRuns ?? 0}
          description="All time"
          icon={Activity}
          loading={loading}
          variant="runs"
        />
        <StatsCard
          title="Total Distance"
          value={`${(stats?.totalDistanceKm ?? 0).toFixed(1)} km`}
          description="All time"
          icon={TrendingUp}
          loading={loading}
          variant="distance"
        />
        <StatsCard
          title="This Week"
          value={`${(stats?.thisWeekKm ?? 0).toFixed(1)} km`}
          description={`${stats?.thisWeekRuns ?? 0} runs`}
          icon={Timer}
          loading={loading}
          variant="weekly"
        />
        <StatsCard
          title="Active Plan"
          value={stats?.activePlan?.plan_type ?? 'None'}
          description={stats?.activePlan ? `Week ${stats.activePlan.current_week_num}` : 'No active plan'}
          icon={Calendar}
          loading={loading}
          variant="plan"
        />
      </div>

      {/* Recent Runs */}
      <Card className="coach-card">
        <CardHeader>
          <CardTitle className="coach-heading text-xl">Recent Runs</CardTitle>
          <CardDescription>Your runs from the last 14 days</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:gap-3 md:overflow-visible scrollbar-hide">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 min-w-[200px] md:min-w-0 md:w-full rounded-lg shrink-0 md:shrink" />
              ))}
            </div>
          ) : recentRuns.length > 0 ? (
            <>
              {/* Mobile: Horizontal scroll */}
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide md:hidden">
                {recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="run-list-item flex flex-col gap-2 min-w-[180px] shrink-0 snap-start p-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20">
                        <Activity className="w-4 h-4 text-primary" />
                      </div>
                      <p className="font-semibold text-sm truncate">{run.workout_name || run.run_type || 'Run'}</p>
                    </div>
                    <div className="flex justify-between items-end">
                      <p className="text-xs text-muted-foreground">
                        {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <div className="text-right">
                        <p className="metric-value text-base font-bold">{run.distance_km?.toFixed(1)} km</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: Vertical list */}
              <div className="hidden md:block space-y-2">
                {recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="run-list-item flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
                        <Activity className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">{run.workout_name || run.run_type || 'Run'}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="metric-value text-lg">{run.distance_km?.toFixed(1)} km</p>
                      <p className="text-sm text-muted-foreground font-mono">{run.avg_pace_str || '-'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Activity className="empty-state-icon" />
              <p className="font-medium">No runs yet</p>
              <p className="text-sm mt-1">
                Connect Strava or log a run manually to get started.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* This Week's Training */}
      <Card className="coach-card">
        <CardHeader>
          <CardTitle className="coach-heading text-xl">This Week&apos;s Training</CardTitle>
          <CardDescription>
            {activePlan
              ? `${activePlan.plan_type} - Week ${activePlan.current_week_num} of ${activePlan.duration_weeks}${activePlan.week_info?.weekDateRange ? ` (${activePlan.week_info.weekDateRange})` : ''}`
              : 'No active training plan'}
            {activePlan?.isAfterEnd && (
              <Badge variant="outline" className="ml-2 text-amber-600 border-amber-600">Plan Completed</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(7)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : activePlan && currentWeekWorkouts ? (
            <div className="space-y-3">
              {/* Phase/Focus Info */}
              {currentWeekInfo && (currentWeekInfo.phase || currentWeekInfo.focus) && (
                <p className="text-sm text-muted-foreground mb-4">
                  {currentWeekInfo.phase && <span className="font-medium">{currentWeekInfo.phase}</span>}
                  {currentWeekInfo.phase && currentWeekInfo.focus && ' - '}
                  {currentWeekInfo.focus && <span className="italic">{currentWeekInfo.focus}</span>}
                </p>
              )}

              {/* Workouts Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Day</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Workout</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Distance</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden md:table-cell">Pace</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden lg:table-cell">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(currentWeekWorkouts).map(([day, workout]) => {
                      const isToday = isWorkoutToday(day);
                      return (
                        <tr
                          key={day}
                          className={`border-b last:border-0 transition-colors ${
                            isToday
                              ? 'bg-gradient-to-r from-primary/10 to-secondary/10 border-l-4 border-l-primary'
                              : 'hover:bg-accent/50'
                          }`}
                        >
                          <td className="py-3 px-2 font-medium">
                            <div className="flex items-center gap-2">
                              {day}
                              {isToday && (
                                <Badge variant="default" className="text-[10px] py-0 px-1.5 bg-primary pulse-badge">
                                  <Flame className="w-3 h-3 mr-0.5" />
                                  Today
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <Badge variant="outline" className={`font-normal ${isToday ? 'border-primary text-primary' : ''}`}>
                              {typeof workout === 'object' ? workout.type : workout}
                            </Badge>
                          </td>
                          <td className={`py-3 px-2 ${isToday ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {typeof workout === 'object' ? (workout.distance || workout.duration || '-') : '-'}
                          </td>
                          <td className="py-3 px-2 text-muted-foreground hidden md:table-cell">
                            {typeof workout === 'object' ? (workout.target_pace || workout.target_hr || '-') : '-'}
                          </td>
                          <td className="py-3 px-2 text-muted-foreground text-xs hidden lg:table-cell max-w-[200px] truncate">
                            {typeof workout === 'object' && workout.description
                              ? (workout.description.length > 50
                                  ? workout.description.substring(0, 50) + '...'
                                  : workout.description)
                              : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground mt-4 italic">
                Go to Training Plan for full plan details and week navigation
              </p>
            </div>
          ) : activePlan ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No workouts found for this week.</p>
              <p className="text-sm mt-1">
                Check the Training Plan page for details.
              </p>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No active training plan.</p>
              <p className="text-sm mt-1">
                Go to Training Plan to generate a new plan.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
