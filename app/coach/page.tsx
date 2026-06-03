'use client';

import { useSession } from 'next-auth/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Timer, TrendingUp, Calendar, Target, Zap, Play, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats, Run, TrainingPlan, PlanWeek, Workout } from '@/lib/db/types';
import { isWorkoutToday, getTodayDayName, sortWorkoutsByDay } from '@/lib/utils/week-calculator';
import { CoachHealthWidget } from '@/components/coach/coach-health-widget';

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
        if (statsRes.ok) setStats(await statsRes.json());
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
        setStats({ totalRuns: 0, totalDistanceKm: 0, thisWeekKm: 0, thisWeekRuns: 0, activePlan: null });
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
    if (planJson.weeks && Array.isArray(planJson.weeks)) {
      const currentWeek = planJson.weeks.find((w: PlanWeek) => w.week_number === currentWeekNum);
      if (currentWeek?.workouts) return currentWeek.workouts;
    }
    if (planJson.current_week) {
      const cw = planJson.current_week;
      if (cw.workouts) return cw.workouts;
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
    if (currentWeek) return { phase: currentWeek.phase || '', focus: currentWeek.focus || '' };
    return null;
  };

  const currentWeekWorkouts = getCurrentWeekWorkouts();
  const currentWeekInfo = getCurrentWeekInfo();

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
  const planProgress = activePlan ? Math.round(((activePlan.current_week_num || 1) / (activePlan.duration_weeks || 1)) * 100) : 0;

  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const isRestDay = !todaysWorkout || todaysWorkout.workout.type?.toLowerCase().includes('rest') || todaysWorkout.workout.type?.toLowerCase().includes('off');

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl animate-pulse">
        <div className="h-10 w-48 rounded-lg" style={{ background: 'var(--rc-line)' }} />
        <div className="h-48 rounded-[28px]" style={{ background: 'var(--rc-ink)' }} />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-[20px]" style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page Header */}
      <div>
        <div className="rc-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
          Welcome back, {session?.user?.name?.split(' ')[0] || 'Coach'}
        </div>
        <h1
          className="text-[44px] font-bold leading-none"
          style={{ letterSpacing: '-0.025em', color: 'var(--rc-ink)' }}
        >
          {isRestDay ? (
            <>Today is <span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 500 }}>a rest day.</span></>
          ) : todaysWorkout ? (
            <>Today&apos;s <span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 500 }}>{todaysWorkout.workout.type?.toLowerCase() || 'run'}.</span></>
          ) : (
            <>Ready to <span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 500 }}>train.</span></>
          )}
        </h1>
        <p className="mt-2.5 text-sm max-w-[620px]" style={{ color: 'var(--rc-ink-3)' }}>
          {isRestDay
            ? 'Recovery is part of training. Sleep, walk, stretch.'
            : todaysWorkout
              ? `${todaysWorkout.workout.distance || ''} ${todaysWorkout.workout.duration ? `· ${todaysWorkout.workout.duration}` : ''} ${todaysWorkout.workout.target_pace ? `· ${todaysWorkout.workout.target_pace}` : ''}`
              : activePlan ? 'Check your training plan for today\'s workout.' : 'Generate a training plan to get started.'}
        </p>
      </div>

      {/* Today Hero Card — dark ink background */}
      <div
        className="relative rounded-[28px] overflow-hidden"
        style={{
          background: 'var(--rc-ink)',
          color: '#FBFAF6',
        }}
      >
        {/* Radial gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(700px 320px at 105% 110%, oklch(0.45 0.16 245 / 0.55), transparent 60%), radial-gradient(380px 220px at -10% -20%, rgba(255,255,255,0.04), transparent 70%)',
          }}
        />
        <div className="relative p-8 md:p-9">
          <div
            className="rc-mono text-[11px] font-medium uppercase mb-3.5"
            style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 400, fontSize: '18px', letterSpacing: '-0.01em', textTransform: 'none' }}
          >
            — {dayName}, {dateStr}
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2
                className="text-[48px] md:text-[56px] font-bold leading-[0.96]"
                style={{ letterSpacing: '-0.03em' }}
              >
                {isRestDay ? (
                  <>Rest day.<br /><span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 400, color: 'oklch(0.78 0.13 245)' }}>Sleep, walk, stretch.</span></>
                ) : todaysWorkout ? (
                  <>{todaysWorkout.workout.type}<br /><span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 400, color: 'oklch(0.78 0.13 245)' }}>{todaysWorkout.workout.distance || ''}</span></>
                ) : (
                  <>No plan.<br /><span style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 400, color: 'oklch(0.78 0.13 245)' }}>Create one.</span></>
                )}
              </h2>
              {todaysWorkout && !isRestDay && (
                <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.65)', maxWidth: 460 }}>
                  {todaysWorkout.workout.duration && `Duration: ${todaysWorkout.workout.duration}`}
                  {todaysWorkout.workout.target_pace && ` · Pace: ${todaysWorkout.workout.target_pace}`}
                </p>
              )}
            </div>
            {activePlan && (
              <div className="text-right">
                <div className="rc-kicker" style={{ color: 'rgba(255,255,255,0.45)' }}>Plan</div>
                <div className="text-[22px] font-bold mt-1" style={{ letterSpacing: '-0.02em' }}>
                  {activePlan.plan_type || '10K'} · Wk {activePlan.current_week_num} of {activePlan.duration_weeks}
                </div>
                {(activePlan as any).race_date && (
                  <div className="rc-mono text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
                    RACE — {new Date((activePlan as any).race_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Progress strip */}
          {activePlan && (
            <div
              className="flex items-center gap-6 mt-7 pt-6"
              style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}
            >
              <div className="flex-1">
                <div className="rc-kicker" style={{ color: 'rgba(255,255,255,0.55)' }}>Plan progress</div>
                <div className="flex gap-1 mt-4">
                  {Array.from({ length: activePlan.duration_weeks || 8 }).map((_, i) => (
                    <span
                      key={i}
                      className="flex-1 h-2 rounded-[3px]"
                      style={{
                        background: i < (activePlan.current_week_num || 1) - 1
                          ? 'var(--rc-blue)'
                          : i === (activePlan.current_week_num || 1) - 1
                            ? 'var(--rc-blue)'
                            : 'rgba(255,255,255,0.12)',
                        boxShadow: i === (activePlan.current_week_num || 1) - 1 ? '0 0 0 3px oklch(0.58 0.17 245 / 0.25)' : 'none',
                      }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-2 rc-mono text-[10.5px]" style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                  <span>WEEK 1</span><span>WEEK {activePlan.duration_weeks}</span>
                </div>
              </div>
              <div
                className="text-[52px] font-bold leading-none"
                style={{
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  background: 'linear-gradient(120deg, #fff, oklch(0.78 0.16 245))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                {planProgress}<span className="text-[22px] ml-1" style={{ color: 'rgba(255,255,255,0.55)', WebkitTextFillColor: 'rgba(255,255,255,0.55)' }}>%</span>
              </div>
            </div>
          )}

          {/* CTA buttons */}
          <div className="flex gap-3 mt-6">
            {todaysWorkout && !isRestDay && (
              <Link
                href="/coach/log"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors"
                style={{ background: 'var(--rc-blue)', color: '#fff' }}
              >
                <Play className="w-4 h-4" /> Log This Run
              </Link>
            )}
            {!activePlan && (
              <Link
                href="/coach/plan"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors"
                style={{ background: 'var(--rc-blue)', color: '#fff' }}
              >
                <Target className="w-4 h-4" /> Create Plan
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-3.5 grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: 'Total runs',
            value: stats?.totalRuns ?? 0,
            unit: '',
            desc: 'all time',
            icon: Activity,
            accent: 'var(--rc-blue)',
            iconBg: 'oklch(0.96 0.04 240)',
            iconColor: 'var(--rc-blue-deep)',
          },
          {
            title: 'Total distance',
            value: `${((stats?.totalDistanceKm ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            unit: 'km',
            desc: 'all time',
            icon: TrendingUp,
            accent: 'oklch(0.78 0.15 75)',
            iconBg: 'oklch(0.96 0.05 75)',
            iconColor: 'oklch(0.50 0.13 75)',
          },
          {
            title: 'This week',
            value: `${(stats?.thisWeekKm ?? 0).toFixed(1)}`,
            unit: 'km',
            desc: `${stats?.thisWeekRuns ?? 0} run${(stats?.thisWeekRuns ?? 0) !== 1 ? 's' : ''} logged`,
            icon: Timer,
            accent: 'var(--rc-good)',
            iconBg: 'oklch(0.96 0.04 150)',
            iconColor: 'oklch(0.42 0.10 150)',
          },
          {
            title: 'Active plan',
            value: stats?.activePlan?.plan_type ?? 'None',
            unit: '',
            desc: stats?.activePlan ? `Week ${stats.activePlan.current_week_num}` : 'No active plan',
            icon: Calendar,
            accent: 'oklch(0.55 0.18 305)',
            iconBg: 'oklch(0.96 0.04 305)',
            iconColor: 'oklch(0.42 0.18 305)',
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="rc-card relative overflow-hidden p-5"
            >
              <span
                className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]"
                style={{ background: card.accent }}
              />
              <div className="flex items-center justify-between mb-2">
                <div className="rc-kicker">{card.title}</div>
                <div className="p-2 rounded-xl" style={{ background: card.iconBg, color: card.iconColor }}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div
                className="text-[28px] font-bold"
                style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}
              >
                {card.value}
                {card.unit && <span className="text-[12px] font-medium ml-1" style={{ color: 'var(--rc-ink-3)' }}>{card.unit}</span>}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--rc-ink-4)' }}>{card.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Supervisor: 7-day coach health */}
      <CoachHealthWidget />

      {/* Main Grid: Recent Runs + This Week */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Recent Runs */}
        <div className="rc-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
            <div>
              <div className="rc-kicker mb-1">Last 14 days</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Recent runs</h3>
            </div>
            <Link
              href="/coach/log"
              className="rc-mono text-[11px] px-3 py-1.5 rounded-full"
              style={{ background: 'transparent', border: '1px solid var(--rc-line-2)', color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}
            >
              All runs →
            </Link>
          </div>
          {recentRuns.length > 0 ? (
            <div>
              {recentRuns.slice(0, 5).map((run, idx) => (
                <div
                  key={run.id}
                  className="grid items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--rc-surface-2)]"
                  style={{
                    gridTemplateColumns: '36px 1fr auto auto',
                    borderBottom: idx < Math.min(recentRuns.length, 5) - 1 ? '1px solid var(--rc-line)' : 'none',
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-[10px] grid place-items-center"
                    style={{ background: 'oklch(0.96 0.04 240)', color: 'var(--rc-blue-deep)' }}
                  >
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[14.5px] font-semibold" style={{ letterSpacing: '-0.005em', color: 'var(--rc-ink)' }}>
                      {run.workout_name || run.run_type || 'Run'}
                    </div>
                    <div className="rc-mono text-[11px] uppercase mt-0.5" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>
                      {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} · {new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
                      {run.duration_min ? ` · ${run.duration_min} MIN` : ''}
                    </div>
                  </div>
                  <div className="rc-mono font-semibold text-[16px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                    {run.distance_km?.toFixed(1)}<span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--rc-ink-3)' }}>km</span>
                  </div>
                  <div className="text-right">
                    <div className="rc-mono text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>{run.avg_pace_str || '-'}</div>
                    {run.avg_hr && (
                      <div className="rc-mono text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>{run.avg_hr} bpm</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--rc-ink-3)' }}>
              <Activity className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
              <p className="text-sm font-medium">No runs yet</p>
              <p className="text-xs mt-1">Connect Strava or log a run to get started</p>
            </div>
          )}
        </div>

        {/* Right Rail */}
        <div className="flex flex-col gap-5">
          {/* Focus card */}
          {currentWeekInfo && currentWeekInfo.focus && (
            <div className="rc-card p-6">
              <div className="rc-kicker mb-1.5">Focus · Week {activePlan?.current_week_num}</div>
              <h3 className="text-[19px] font-bold" style={{ letterSpacing: '-0.02em', color: 'var(--rc-ink)' }}>
                {currentWeekInfo.focus}
              </h3>
              {currentWeekInfo.phase && (
                <p className="text-sm mt-2" style={{ color: 'var(--rc-ink-3)' }}>{currentWeekInfo.phase}</p>
              )}
            </div>
          )}

          {/* This Week's Training */}
          <div className="rc-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
              <div>
                <div className="rc-kicker mb-1">
                  {activePlan?.week_info?.weekDateRange || `Week ${activePlan?.current_week_num || '?'}`}
                </div>
                <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>This week&apos;s training</h3>
              </div>
              <Link
                href="/coach/plan"
                className="rc-mono text-[11px] px-3 py-1.5 rounded-full"
                style={{ background: 'transparent', border: '1px solid var(--rc-line-2)', color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}
              >
                Plan →
              </Link>
            </div>
            {currentWeekWorkouts ? (
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Day', 'Workout', 'km', 'Pace'].map((h) => (
                      <th
                        key={h}
                        className="rc-mono text-[10.5px] font-medium uppercase text-left px-5 py-3"
                        style={{
                          color: 'var(--rc-ink-3)',
                          letterSpacing: '0.1em',
                          background: 'var(--rc-surface-2)',
                          borderBottom: '1px solid var(--rc-line)',
                          borderTop: '1px solid var(--rc-line)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortWorkoutsByDay(currentWeekWorkouts).map(([day, workout]) => {
                    const w = typeof workout === 'object' ? workout : { type: workout } as Workout;
                    const today = isWorkoutToday(day);
                    const isRest = w.type?.toLowerCase().includes('rest') || w.type?.toLowerCase().includes('off');
                    return (
                      <tr
                        key={day}
                        className="transition-colors"
                        style={{
                          background: today ? 'oklch(0.96 0.03 240)' : 'transparent',
                          borderBottom: '1px solid var(--rc-line)',
                        }}
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-sm" style={{ color: 'var(--rc-ink)' }}>{day.slice(0, 3)}</div>
                          {today && (
                            <span className="rc-mono text-[10px]" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>TODAY</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className="rc-mono text-[10.5px] font-medium px-2 py-0.5 rounded-[5px]"
                            style={{
                              background: isRest ? 'rgba(14,15,12,0.05)' : w.type?.toLowerCase().includes('long') ? 'oklch(0.96 0.03 240)' : 'oklch(0.96 0.04 150)',
                              color: isRest ? 'var(--rc-ink-3)' : w.type?.toLowerCase().includes('long') ? 'oklch(0.42 0.13 240)' : 'oklch(0.42 0.10 150)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            {w.type || 'Rest'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 rc-mono text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                          {w.distance || '-'}
                        </td>
                        <td className="px-5 py-3.5 rc-mono text-xs" style={{ color: 'var(--rc-ink-3)' }}>
                          {w.target_pace || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : activePlan ? (
              <div className="py-12 text-center" style={{ color: 'var(--rc-ink-3)' }}>
                <Calendar className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--rc-ink-4)' }} />
                <p className="text-sm">No workouts for this week</p>
              </div>
            ) : (
              <div className="py-12 text-center" style={{ color: 'var(--rc-ink-3)' }}>
                <Calendar className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--rc-ink-4)' }} />
                <p className="text-sm">No active plan</p>
                <Link href="/coach/plan" className="text-sm mt-1 underline" style={{ color: 'var(--rc-blue)' }}>Create one →</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
