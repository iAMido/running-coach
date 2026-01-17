'use client';

import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Activity, Timer, TrendingUp, Calendar } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DashboardStats, Run, TrainingPlan, PlanWeek, Workout } from '@/lib/db/types';

function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <Card className="coach-card stat-card stat-card-sparkline">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="metric-label">
          {title}
        </CardTitle>
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/15 to-secondary/15">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 w-24" />
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="coach-heading text-3xl tracking-tight">
          Welcome back, {session?.user?.name?.split(' ')[0] || 'Coach'}
        </h1>
        <p className="text-muted-foreground mt-2">
          Here&apos;s your training overview for today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Runs"
          value={stats?.totalRuns ?? 0}
          description="All time"
          icon={Activity}
          loading={loading}
        />
        <StatsCard
          title="Total Distance"
          value={`${(stats?.totalDistanceKm ?? 0).toFixed(1)} km`}
          description="All time"
          icon={TrendingUp}
          loading={loading}
        />
        <StatsCard
          title="This Week"
          value={`${(stats?.thisWeekKm ?? 0).toFixed(1)} km`}
          description={`${stats?.thisWeekRuns ?? 0} runs`}
          icon={Timer}
          loading={loading}
        />
        <StatsCard
          title="Active Plan"
          value={stats?.activePlan?.plan_type ?? 'None'}
          description={stats?.activePlan ? `Week ${stats.activePlan.current_week_num}` : 'No active plan'}
          icon={Calendar}
          loading={loading}
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
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : recentRuns.length > 0 ? (
            <div className="space-y-2">
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
              ? `${activePlan.plan_type} - Week ${activePlan.current_week_num}`
              : 'No active training plan'}
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
                    {Object.entries(currentWeekWorkouts).map(([day, workout]) => (
                      <tr key={day} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                        <td className="py-3 px-2 font-medium">{day}</td>
                        <td className="py-3 px-2">
                          <Badge variant="outline" className="font-normal">
                            {typeof workout === 'object' ? workout.type : workout}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
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
                    ))}
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
