'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Target, ChevronLeft, ChevronRight, Sparkles, Calendar, Home, CheckCircle2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { TrainingPlan, PlanWeek, Workout } from '@/lib/db/types';
import { isWorkoutToday, sortWorkoutsByDay } from '@/lib/utils/week-calculator';
import { StrengthWorkout } from '@/components/coach/strength-workout';
import { WorkoutCard, getWorkoutTagClass } from '@/components/coach/workout-card';

const planTypes = [
  { value: 'half-marathon', label: 'Half Marathon' },
  { value: 'marathon', label: 'Marathon' },
  { value: '10k', label: '10K' },
  { value: '5k-speed', label: '5K Speed' },
  { value: 'base-building', label: 'Base Building' },
  { value: 'maintenance', label: 'Maintenance' },
];

const durationOptions = [4, 6, 8, 10, 12, 16];
const runsPerWeekOptions = [3, 4, 5];

export default function TrainingPlanPage() {
  const [planType, setPlanType] = useState('');
  const [duration, setDuration] = useState('8');
  const [runsPerWeek, setRunsPerWeek] = useState('4');
  const [notes, setNotes] = useState('');
  // Rich plan-gen intake (server reads these into the PLAN GENERATION INTAKE
  // block; gives Opus the runway it needs beyond the default 14-day RAG.)
  const [raceDate, setRaceDate] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [recentRaceResult, setRecentRaceResult] = useState('');
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState('');
  const [addressesWhat, setAddressesWhat] = useState('');
  const [limitations, setLimitations] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewingWeek, setViewingWeek] = useState(1);
  const [calculatedCurrentWeek, setCalculatedCurrentWeek] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('generate');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Streaming progress
  const [streamChars, setStreamChars] = useState(0);
  const [streamPreview, setStreamPreview] = useState('');

  useEffect(() => {
    fetchPlan();
  }, []);

  const fetchPlan = async () => {
    try {
      const response = await fetch('/api/coach/plans');
      if (response.ok) {
        const data = await response.json();
        if (data.plan) {
          setActivePlan(data.plan);
          const currentWeek = data.plan.current_week_num || 1;
          setCalculatedCurrentWeek(currentWeek);
          setViewingWeek(currentWeek);
          setActiveTab('current');
        }
      }
    } catch (err) {
      console.error('Failed to fetch plan:', err);
    } finally {
      setLoading(false);
    }
  };

  const jumpToCurrentWeek = () => {
    setViewingWeek(calculatedCurrentWeek);
  };

  const isViewingCurrentWeek = viewingWeek === calculatedCurrentWeek;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setStreamChars(0);
    setStreamPreview('');

    try {
      // Stream the generation so the user sees progress live instead of
      // staring at a spinner for 30-60s. Each SSE chunk extends streamPreview.
      const response = await fetch('/api/coach/plans/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: planTypes.find(p => p.value === planType)?.label || planType,
          durationWeeks: parseInt(duration),
          runsPerWeek: parseInt(runsPerWeek),
          notes,
          // Rich intake — server reads into PLAN GENERATION INTAKE block.
          // Each field is optional; omit empty strings so Zod accepts them.
          ...(raceDate ? { raceDate } : {}),
          ...(targetTime ? { targetTime } : {}),
          ...(recentRaceResult ? { recentRaceResult } : {}),
          ...(currentWeeklyKm ? { currentWeeklyKm: parseFloat(currentWeeklyKm) } : {}),
          ...(addressesWhat ? { addressesWhat } : {}),
          ...(limitations ? { limitations } : {}),
        }),
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Stream failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalPlan: TrainingPlan | null = null;
      let totalChars = 0;
      const previewWindow: string[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const raw of events) {
          const eventLine = raw.split('\n').find(l => l.startsWith('event:'));
          const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const eventName = eventLine.slice(6).trim();
          let data: unknown;
          try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (eventName === 'token') {
            const text = (data as { text: string }).text;
            totalChars += text.length;
            setStreamChars(totalChars);
            previewWindow.push(text);
            if (previewWindow.length > 200) previewWindow.shift();
            setStreamPreview(previewWindow.join(''));
          } else if (eventName === 'done') {
            finalPlan = (data as { plan: TrainingPlan }).plan;
          } else if (eventName === 'error') {
            throw new Error((data as { message: string }).message);
          }
        }
      }

      if (!finalPlan) throw new Error('Stream ended without a plan');

      setActivePlan(finalPlan);
      setCalculatedCurrentWeek(1);
      setViewingWeek(1);
      setSuccessMessage('Your training plan has been generated successfully!');
      setActiveTab('current');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan');
    } finally {
      setGenerating(false);
    }
  };

  const getPlanWeeks = (): PlanWeek[] => {
    if (!activePlan?.plan_json) return [];
    const planJson = activePlan.plan_json;
    if (planJson.weeks && Array.isArray(planJson.weeks)) return planJson.weeks;
    if (planJson.raw_response) return [];
    return [];
  };

  const getCurrentWeekData = (): PlanWeek | null => {
    const weeks = getPlanWeeks();
    return weeks.find(w => w.week_number === viewingWeek) || null;
  };

  const getWeekDateRange = (weekNum: number): string => {
    if (!activePlan?.start_date) return '';
    const start = new Date(activePlan.start_date);
    start.setDate(start.getDate() + (weekNum - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const weekData = getCurrentWeekData();
  const totalWeeks = activePlan?.duration_weeks || getPlanWeeks().length || 0;
  const planProgress = activePlan ? Math.round(((activePlan.current_week_num || 1) / (activePlan.duration_weeks || 1)) * 100) : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <Skeleton className="h-32 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <Skeleton className="h-64 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="rc-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
          TRAINING PLAN
        </div>
        <h1
          className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
          style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
        >
          Your plan,{' '}
          <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--rc-ink-2)' }}>
            week by week.
          </span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--rc-ink-3)' }}>
          Generate and manage your AI-powered training plan.
        </p>
      </div>

      {/* Tab Toggle */}
      <div
        className="inline-flex gap-[1px] rounded-full p-[3px]"
        style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', boxShadow: 'var(--rc-shadow-1)' }}
      >
        <button
          onClick={() => setActiveTab('current')}
          disabled={!activePlan}
          className="rc-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors disabled:opacity-40"
          style={{
            background: activeTab === 'current' ? 'var(--rc-ink)' : 'transparent',
            color: activeTab === 'current' ? '#fff' : 'var(--rc-ink-3)',
            letterSpacing: '0.06em',
          }}
        >
          CURRENT PLAN
        </button>
        <button
          onClick={() => setActiveTab('generate')}
          className="rc-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium transition-colors"
          style={{
            background: activeTab === 'generate' ? 'var(--rc-ink)' : 'transparent',
            color: activeTab === 'generate' ? '#fff' : 'var(--rc-ink-3)',
            letterSpacing: '0.06em',
          }}
        >
          GENERATE NEW
        </button>
      </div>

      {/* Current Plan Tab */}
      {activeTab === 'current' && (
        <div className="space-y-6">
          {activePlan ? (
            <>
              {/* Plan Header Hero */}
              <div
                className="relative rounded-[28px] overflow-hidden"
                style={{ background: 'var(--rc-ink)', color: '#FBFAF6' }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'radial-gradient(700px 320px at 105% 110%, oklch(0.45 0.16 245 / 0.55), transparent 60%)',
                  }}
                />
                <div className="relative p-8">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="rc-kicker" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        <Target className="w-3.5 h-3.5 inline mr-1.5" />
                        ACTIVE PLAN
                      </div>
                      <h2 className="text-[32px] font-bold mt-2" style={{ letterSpacing: '-0.025em' }}>
                        {activePlan.plan_type}
                      </h2>
                      <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        Week {calculatedCurrentWeek} of {totalWeeks}
                        {activePlan.week_info?.weekDateRange && ` · ${activePlan.week_info.weekDateRange}`}
                      </p>
                    </div>
                    <span
                      className="rc-mono text-[10.5px] font-medium px-3 py-1.5 rounded-full"
                      style={{
                        background: activePlan.isAfterEnd ? 'oklch(0.96 0.05 75)' : 'oklch(0.96 0.04 150)',
                        color: activePlan.isAfterEnd ? 'oklch(0.50 0.13 75)' : 'oklch(0.42 0.10 150)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {activePlan.isAfterEnd ? 'COMPLETED' : 'ACTIVE'}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="flex items-center gap-6 mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                    <div className="flex-1">
                      <div className="flex gap-1">
                        {Array.from({ length: totalWeeks }).map((_, i) => (
                          <span
                            key={i}
                            className="flex-1 h-2 rounded-[3px]"
                            style={{
                              background: i < (activePlan.current_week_num || 1)
                                ? 'var(--rc-blue)'
                                : 'rgba(255,255,255,0.12)',
                              boxShadow: i === (activePlan.current_week_num || 1) - 1 ? '0 0 0 3px oklch(0.58 0.17 245 / 0.25)' : 'none',
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-2 rc-mono text-[10.5px]" style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                        <span>WEEK 1</span><span>WEEK {totalWeeks}</span>
                      </div>
                    </div>
                    <div
                      className="text-[48px] font-bold leading-none"
                      style={{
                        letterSpacing: '-0.03em',
                        fontVariantNumeric: 'tabular-nums',
                        background: 'linear-gradient(120deg, #fff, oklch(0.78 0.16 245))',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                      }}
                    >
                      {planProgress}<span className="text-[20px] ml-1" style={{ color: 'rgba(255,255,255,0.55)', WebkitTextFillColor: 'rgba(255,255,255,0.55)' }}>%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Week Navigation */}
              <div className="rc-card p-0 overflow-hidden">
                <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
                  <button
                    disabled={viewingWeek <= 1}
                    onClick={() => setViewingWeek(w => w - 1)}
                    className="w-9 h-9 rounded-full grid place-items-center transition-colors disabled:opacity-30"
                    style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}
                  >
                    <ChevronLeft className="w-4 h-4" style={{ color: 'var(--rc-ink-2)' }} />
                  </button>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <h3 className="text-[20px] font-bold" style={{ letterSpacing: '-0.02em', color: 'var(--rc-ink)' }}>
                        Week {viewingWeek}
                      </h3>
                      {isViewingCurrentWeek && (
                        <span
                          className="rc-mono text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--rc-blue)', color: '#fff', letterSpacing: '0.08em' }}
                        >
                          CURRENT
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--rc-ink-3)' }}>{getWeekDateRange(viewingWeek)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isViewingCurrentWeek && (
                      <button
                        onClick={jumpToCurrentWeek}
                        className="w-9 h-9 rounded-full grid place-items-center transition-colors"
                        style={{ background: 'var(--rc-blue-soft)', border: '1px solid var(--rc-line)', color: 'var(--rc-blue-deep)' }}
                        title="Jump to current week"
                      >
                        <Home className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      disabled={viewingWeek >= totalWeeks}
                      onClick={() => setViewingWeek(w => w + 1)}
                      className="w-9 h-9 rounded-full grid place-items-center transition-colors disabled:opacity-30"
                      style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}
                    >
                      <ChevronRight className="w-4 h-4" style={{ color: 'var(--rc-ink-2)' }} />
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  {weekData?.focus && (
                    <p
                      className="text-sm text-center mb-5 py-2.5 px-4 rounded-xl"
                      style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}
                    >
                      <strong>Focus:</strong> {weekData.focus}
                    </p>
                  )}

                  {weekData?.workouts && Object.keys(weekData.workouts).length > 0 ? (
                    <div className="space-y-3">
                      {sortWorkoutsByDay(weekData.workouts).map(([day, workout]) => {
                        const isToday = isViewingCurrentWeek && isWorkoutToday(day);
                        return (
                          <WorkoutCard
                            key={day}
                            day={day}
                            workout={workout}
                            isToday={isToday}
                            variant="card"
                          />
                        );
                      })}
                    </div>
                  ) : activePlan.plan_json?.raw_response ? (
                    <pre
                      className="whitespace-pre-wrap text-xs p-4 rounded-xl overflow-auto max-h-96"
                      style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-2)', border: '1px solid var(--rc-line)' }}
                    >
                      {activePlan.plan_json.raw_response}
                    </pre>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12" style={{ color: 'var(--rc-ink-3)' }}>
                      <Calendar className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
                      <p className="text-sm font-medium">No workout details available for this week.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Strength Training */}
              <StrengthWorkout weekNumber={viewingWeek} totalWeeks={totalWeeks} />
            </>
          ) : (
            <div className="rc-card">
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--rc-ink-3)' }}>
                <Target className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
                <p className="text-sm font-medium">No active training plan.</p>
                <button
                  onClick={() => setActiveTab('generate')}
                  className="text-sm mt-2 underline"
                  style={{ color: 'var(--rc-blue)' }}
                >
                  Generate a new plan →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generate Tab */}
      {activeTab === 'generate' && (
        <div className="rc-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
            <div>
              <div className="rc-kicker mb-1">AI-powered</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Generate Training Plan</h3>
            </div>
            <div className={`p-2.5 rounded-xl ${generating ? 'animate-pulse' : ''}`} style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="p-6 space-y-5">
            <p className="text-sm" style={{ color: 'var(--rc-ink-3)' }}>
              Create a personalized plan based on the Run Elite Triphasic methodology.
            </p>

            {successMessage && (
              <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ background: 'var(--rc-good-soft)', color: 'oklch(0.42 0.10 150)' }}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {successMessage}
              </div>
            )}
            {error && (
              <div className="p-3 rounded-xl text-sm" style={{ background: 'oklch(0.95 0.05 25)', color: 'var(--rc-bad)' }}>
                {error}
              </div>
            )}

            {/* Plan Type */}
            <div className="space-y-2">
              <label className="rc-mono text-[11px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Plan Type</label>
              <select
                value={planType}
                onChange={(e) => setPlanType(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: planType ? 'var(--rc-ink)' : 'var(--rc-ink-4)' }}
              >
                <option value="" disabled>Select plan type...</option>
                {planTypes.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <label className="rc-mono text-[11px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Duration (weeks)</label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
              >
                {durationOptions.map((weeks) => (
                  <option key={weeks} value={weeks.toString()}>{weeks} weeks</option>
                ))}
              </select>
            </div>

            {/* Runs per Week */}
            <div className="space-y-2">
              <label className="rc-mono text-[11px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Runs per Week</label>
              <select
                value={runsPerWeek}
                onChange={(e) => setRunsPerWeek(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
              >
                {runsPerWeekOptions.map((num) => (
                  <option key={num} value={num.toString()}>{num} runs/week</option>
                ))}
              </select>
            </div>

            {/* Rich intake — feeds the server's PLAN GENERATION INTAKE block.
                Everything here is optional; server auto-computes 90-day stats,
                PRs, and prior plan continuity regardless. These fields are the
                athlete-supplied half: race date, target time, recent race,
                what to address, limitations. The server-computed half is the
                last-90-days run history. Both go into the prompt. */}
            <div className="rc-card p-5 space-y-4" style={{ background: 'oklch(0.97 0.02 240)', border: '1px solid var(--rc-line)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4" style={{ color: 'var(--rc-blue-deep)' }} />
                <span className="rc-mono text-[11px] font-medium uppercase" style={{ color: 'var(--rc-ink-2)', letterSpacing: '0.08em' }}>
                  Plan Intake — give the model context
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--rc-ink-3)' }}>
                Everything below is optional. The server already pulls your last 90 days of runs, PRs across distances, and your prior plan&apos;s outcome — but these fields make the plan dramatically better when filled.
              </p>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Target race date</label>
                  <input
                    type="date"
                    value={raceDate}
                    onChange={e => setRaceDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
                    style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Target time</label>
                  <input
                    type="text"
                    value={targetTime}
                    onChange={e => setTargetTime(e.target.value)}
                    placeholder="e.g. 52:00 or 1:50:00"
                    className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
                    style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Recent race or time trial</label>
                <input
                  type="text"
                  value={recentRaceResult}
                  onChange={e => setRecentRaceResult(e.target.value)}
                  placeholder="e.g. ran 10K in 52:00 three weeks ago"
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
                  style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Current weekly km <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--rc-ink-4)' }}>(auto-computed from last 90 days if blank)</span></label>
                <input
                  type="number"
                  step="0.1"
                  value={currentWeeklyKm}
                  onChange={e => setCurrentWeeklyKm(e.target.value)}
                  placeholder="e.g. 35"
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
                  style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>What should this plan address?</label>
                <textarea
                  value={addressesWhat}
                  onChange={e => setAddressesWhat(e.target.value)}
                  placeholder="e.g. carry the 80/20 discipline forward from the last block, lift threshold pace by 10s/km, build long-run capacity to 18km"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus:ring-2"
                  style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="rc-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Limitations to respect</label>
                <textarea
                  value={limitations}
                  onChange={e => setLimitations(e.target.value)}
                  placeholder="e.g. evenings only Mon/Wed/Fri, plantar fasciitis history — no double sessions, no quality on Friday before long run"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus:ring-2"
                  style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="rc-mono text-[11px] font-medium uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>Additional Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything else the coach should know..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
              />
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={!planType || generating}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'var(--rc-blue)', color: '#fff' }}
            >
              <Sparkles className="w-4 h-4" />
              {generating ? 'Generating Plan...' : 'Generate Plan'}
            </button>

            {generating && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="animate-pulse rc-mono" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>
                    STREAMING · {streamChars.toLocaleString()} chars
                  </span>
                  <span className="rc-mono" style={{ color: 'var(--rc-ink-4)' }}>
                    {duration} weeks · {planTypes.find(p => p.value === planType)?.label || planType}
                  </span>
                </div>
                <div
                  className="rounded-lg p-3 max-h-56 overflow-y-auto text-[11px] rc-mono whitespace-pre-wrap"
                  style={{
                    background: 'var(--rc-surface-2)',
                    border: '1px solid var(--rc-line)',
                    color: 'var(--rc-ink-3)',
                    lineHeight: 1.45,
                  }}
                >
                  {streamPreview || 'Waiting for first tokens…'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
