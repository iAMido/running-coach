'use client';

import { useSession } from 'next-auth/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Timer, TrendingUp, Calendar, Target, Zap, Play, ChevronRight, HeartPulse, Gauge, Mountain } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats, Run, TrainingPlan, PlanWeek, Workout } from '@/lib/db/types';
import { climbCategory, TARGET_RACE } from '@/lib/utils/elevation';
import { isWorkoutToday, getTodayDayName, sortWorkoutsByDay } from '@/lib/utils/week-calculator';
import { CoachHealthWidget } from '@/components/coach/coach-health-widget';
import { useSyncOnOpen } from '@/lib/hooks/use-sync-on-open';

export default function CoachDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Background pull from intervals.icu. Renders from the database first and
  // re-reads only if the sync actually imported something, so the page never
  // waits on a third party.
  useSyncOnOpen(fetchData);

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

          {/* Readiness verdict — deterministic GO/EASY/REST computed
              server-side from fatigue + yesterday's zones + today's plan.
              Same signals the chat coach reads, so the app never
              contradicts itself. */}
          {stats?.readiness && (
            <div className="flex items-center gap-3 mt-6 flex-wrap">
              <span
                className="rc-mono text-[12px] font-bold px-3.5 py-1.5 rounded-full"
                style={{
                  letterSpacing: '0.1em',
                  background:
                    stats.readiness.verdict === 'GO'
                      ? 'oklch(0.55 0.15 150)'
                      : stats.readiness.verdict === 'EASY'
                        ? 'oklch(0.65 0.15 75)'
                        : 'oklch(0.55 0.19 25)',
                  color: '#fff',
                }}
              >
                {stats.readiness.verdict === 'GO' ? '▲ GO' : stats.readiness.verdict === 'EASY' ? '● EASY' : '■ REST'}
              </span>
              <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {stats.readiness.reasons[0]}
              </span>
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

      {/* Morning-after coach note — generated by Haiku when Strava sync
          imports a run, stored in runs.coach_notes. Shows only while the
          run is fresh (36h) so it reads as a reaction, not an archive. */}
      {(() => {
        const latest = recentRuns[0];
        const fresh =
          latest?.coach_notes &&
          Date.now() - new Date(latest.date).getTime() < 36 * 60 * 60 * 1000;
        if (!fresh) return null;
        return (
          <div className="rc-card relative overflow-hidden p-5">
            <span
              className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]"
              style={{ background: 'oklch(0.65 0.15 75)' }}
            />
            <div className="rc-kicker mb-2">Coach&apos;s note on your last run</div>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--rc-ink)' }}>
              {latest.coach_notes}
            </p>
            <div className="rc-mono text-[10.5px] mt-2" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}>
              {latest.workout_name || 'Run'} · {latest.distance_km?.toFixed(1)}km ·{' '}
              {new Date(latest.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
            </div>
          </div>
        );
      })()}

      {/* Stat Cards */}
      <div className="grid gap-3.5 grid-cols-2 lg:grid-cols-5">
        {[
          // 1. THIS WEEK — actual against planned. Falls back to the old
          //    actual-only display when there is no plan to compare against.
          (() => {
            const done = stats?.thisWeekKm ?? 0;
            const planned = stats?.plannedWeek;
            return {
              title: 'This week',
              value: planned?.km ? `${done.toFixed(1)} / ${planned.km.toFixed(0)}` : done.toFixed(1),
              unit: 'km',
              desc: planned
                ? `${stats?.thisWeekRuns ?? 0} of ${planned.sessions} sessions`
                : `${stats?.thisWeekRuns ?? 0} run${(stats?.thisWeekRuns ?? 0) !== 1 ? 's' : ''} logged`,
              icon: Timer,
              accent: 'var(--rc-good)',
              iconBg: 'oklch(0.96 0.04 150)',
              iconColor: 'oklch(0.42 0.10 150)',
              valueColor: undefined as string | undefined,
            };
          })(),

          // 2. FITNESS — CTL and its direction against a named anchor.
          //    The anchor is stated because CTL moves ~0.7 in three days, more
          //    than the gap between plausible anchor choices — without naming
          //    it the delta shifts for reasons that are not training. The prior
          //    value is shown so the subtraction is reproducible.
          (() => {
            const f = stats?.fitness;
            const delta = f?.delta;
            const dir = delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
            const prior = f?.ctlPrior != null ? ` (was ${f.ctlPrior.toFixed(1)})` : '';
            return {
              title: 'Fitness',
              value: f?.ctl != null ? f.ctl.toFixed(1) : '--',
              unit: '',
              desc:
                f?.ctl == null
                  ? 'no recovery data'
                  : dir === null
                    ? 'no 4-week comparison yet'
                    : dir === 'flat'
                      ? `unchanged vs 4 weeks ago${prior}`
                      : `${dir} ${Math.abs(delta as number).toFixed(1)} vs 4 weeks ago${prior}`,
              icon: TrendingUp,
              accent: 'var(--rc-blue)',
              iconBg: 'oklch(0.96 0.04 240)',
              iconColor: 'var(--rc-blue-deep)',
              valueColor: undefined as string | undefined,
            };
          })(),

          // 3. RECOVERY — HRV is never shown bare; it is meaningless without
          //    the baseline. HRV is null ~12% of nights, and a missing reading
          //    must not read as a bad one, so sleep carries the tile instead.
          (() => {
            const r = stats?.recoveryTile;
            const sleep = r?.sleepHours != null ? `slept ${r.sleepHours.toFixed(1)} h` : null;

            // How old the readings are. Normally "yesterday": the nightly sync
            // writes today's row just after local midnight, before the watch
            // has uploaded anything, so the freshest real reading is the night
            // before. Unlabelled, a day-old HRV reads as this morning's.
            const age = r?.ageDays ?? null;
            const stale = age != null && age > 3;
            const ageLabel =
              age == null || age === 0 ? null
              : age === 1 ? 'yesterday'
              : `${age} days ago`;
            const ageNote = stale ? `${ageLabel} — stale, watch not synced` : ageLabel;

            if (!r) {
              return {
                title: 'Recovery', value: '--', unit: '', desc: 'no recovery data',
                icon: HeartPulse, accent: 'oklch(0.78 0.15 75)',
                iconBg: 'oklch(0.96 0.05 75)', iconColor: 'oklch(0.50 0.13 75)',
                valueColor: undefined as string | undefined,
              };
            }

            // The DELTA is the headline, not the raw HRV. 67 carries no
            // information on its own — nobody knows whether it is good without
            // the baseline — so putting it at 28px bold sends the eye to the
            // meaningless half. Same principle as decoupling: the comparison is
            // the signal, the raw figure is provenance.
            const hasHrv = r.hrv != null && r.hrvDelta != null;
            const sign = (r.hrvDelta ?? 0) >= 0 ? '+' : '';

            if (hasHrv) {
              const provenance = [
                `HRV ${Math.round(r.hrv as number)}`,
                r.hrvBaseline != null ? `baseline ${r.hrvBaseline.toFixed(1)}` : null,
                sleep,
                ageNote,
              ].filter(Boolean).join(' · ');
              return {
                title: 'Recovery', value: `${sign}${r.hrvDelta}`, unit: 'vs baseline',
                desc: provenance,
                icon: HeartPulse, accent: 'oklch(0.78 0.15 75)',
                iconBg: 'oklch(0.96 0.05 75)', iconColor: 'oklch(0.50 0.13 75)',
                valueColor: undefined as string | undefined,
              };
            }

            // HRV present but no baseline yet: show it, and say it cannot be
            // placed rather than implying the bare number means something.
            if (r.hrv != null) {
              return {
                title: 'Recovery', value: `HRV ${Math.round(r.hrv)}`, unit: '',
                desc: ['no baseline yet', sleep, ageNote].filter(Boolean).join(' · '),
                icon: HeartPulse, accent: 'oklch(0.78 0.15 75)',
                iconBg: 'oklch(0.96 0.05 75)', iconColor: 'oklch(0.50 0.13 75)',
                valueColor: undefined as string | undefined,
              };
            }

            // No HRV (~12% of nights). Sleep carries the tile; the absence is
            // stated so it never reads as a bad reading.
            return {
              title: 'Recovery',
              value: r.sleepHours != null ? `${r.sleepHours.toFixed(1)}` : '--',
              unit: r.sleepHours != null ? 'h slept' : '',
              desc: r.sleepHours != null
                ? ['no HRV reading', ageNote].filter(Boolean).join(' · ')
                : 'no recovery data',
              icon: HeartPulse, accent: 'oklch(0.78 0.15 75)',
              iconBg: 'oklch(0.96 0.05 75)', iconColor: 'oklch(0.50 0.13 75)',
              valueColor: undefined as string | undefined,
            };
          })(),

          // 4. LOAD RAMP — how fast load is climbing. Coloured, because the
          //    number only matters relative to a safe rate of increase.
          (() => {
            const l = stats?.loadRamp;
            const pct = l?.pctChange;
            const colour =
              pct == null ? undefined
                : pct > 30 ? 'var(--rc-bad, oklch(0.55 0.20 25))'
                  : pct > 10 ? 'oklch(0.60 0.15 75)'
                    : 'oklch(0.45 0.12 150)';
            return {
              title: 'Load ramp',
              value: pct == null ? '--' : `${pct > 0 ? '+' : ''}${pct}%`,
              unit: '',
              desc:
                pct == null
                  ? 'needs 3 weeks of history'
                  : `${l?.last7} vs ${l?.weeklyAvg28} weekly avg`,
              icon: Gauge,
              accent: 'oklch(0.55 0.18 305)',
              iconBg: 'oklch(0.96 0.04 305)',
              iconColor: 'oklch(0.42 0.18 305)',
              valueColor: colour,
            };
          })(),

          // 5. VERT — weekly climb. Earns a tile (where Efficiency Factor did
          //    not) because it changes week to week and drives a real weekly
          //    decision: this athlete is building toward a 61.9 m/km race off a
          //    history whose steepest run ever is 20.2, so the question "did I
          //    climb this week" has an answer he can act on before Sunday.
          //
          //    The gradient, not the total, carries the meaning — 600 m over
          //    60 km is flat running. So m/km is the subtitle, with the band
          //    name, and a total drawn from only some of the week's runs says
          //    so rather than passing itself off as the week's climbing.
          (() => {
            const v = stats?.weeklyVert;
            const band = climbCategory(v?.vertPerKm ?? null);
            const partial = v != null && v.measuredRuns < v.totalRuns;
            return {
              title: 'Vert',
              value: v == null ? '--' : `${v.gainM}`,
              unit: v == null ? '' : 'm',
              desc:
                v == null
                  ? (stats?.thisWeekRuns ?? 0) === 0
                    ? 'no runs this week'
                    : 'not measured this week'
                  : partial
                    ? `${v.measuredRuns} of ${v.totalRuns} runs measured — at least`
                    : v.vertPerKm != null
                      ? `${v.vertPerKm.toFixed(1)} m/km · ${band} · race ${TARGET_RACE.vertPerKm.toFixed(0)}`
                      : 'no distance to compare against',
              icon: Mountain,
              accent: 'oklch(0.55 0.14 145)',
              iconBg: 'oklch(0.96 0.04 145)',
              iconColor: 'oklch(0.42 0.14 145)',
              // Deliberately uncoloured. There is no established good or bad
              // weekly vert for this athlete yet — 128 measured runs and no
              // mountain block behind him. Colouring it would assert a verdict
              // the data cannot support, the same mistake the aerobic-control
              // scorecard row exists to avoid.
              valueColor: undefined as string | undefined,
            };
          })(),
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
                style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: card.valueColor ?? 'var(--rc-ink)' }}
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
