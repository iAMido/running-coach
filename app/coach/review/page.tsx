'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Calendar, Brain, Activity, TrendingUp, Wand2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Run, TrainingPlan } from '@/lib/db/types';

export default function WeeklyReviewPage() {
  const [overallFeeling, setOverallFeeling] = useState([7]);
  const [sleepQuality, setSleepQuality] = useState([7]);
  const [stressLevel, setStressLevel] = useState([5]);
  const [injuryNotes, setInjuryNotes] = useState('');
  const [achievements, setAchievements] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(true);
  const [weeklyRuns, setWeeklyRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [adjustmentRequest, setAdjustmentRequest] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustmentResult, setAdjustmentResult] = useState<{
    summary?: string;
    recommendations?: string[];
    warnings?: string[];
    planUpdated?: boolean;
  } | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  useEffect(() => {
    fetchWeeklyRuns();
    fetchActivePlan();
  }, []);

  const fetchActivePlan = async () => {
    try {
      const response = await fetch('/api/coach/plans');
      if (response.ok) {
        const data = await response.json();
        setActivePlan(data.plan || null);
      }
    } catch (err) {
      console.error('Failed to fetch plan:', err);
    }
  };

  const fetchWeeklyRuns = async () => {
    try {
      const response = await fetch('/api/coach/runs?days=7&limit=20');
      if (response.ok) {
        const data = await response.json();
        setWeeklyRuns(data.runs || []);
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setRunsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/coach/review/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overallFeeling: overallFeeling[0],
          sleepQuality: sleepQuality[0],
          stressLevel: stressLevel[0],
          injuryNotes,
          achievements,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze week');
      }

      setAiAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get analysis');
    } finally {
      setLoading(false);
    }
  };

  const totalDistance = weeklyRuns.reduce((sum, run) => sum + (run.distance_km || 0), 0);
  const totalDuration = weeklyRuns.reduce((sum, run) => sum + (run.duration_min || 0), 0);

  const getWeekDateRange = (): string => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dayOfWeek);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return `${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${saturday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const handleAdjustPlan = async () => {
    if (!activePlan) return;

    setAdjusting(true);
    setAdjustmentError(null);
    setAdjustmentResult(null);

    try {
      const response = await fetch('/api/coach/plans/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustmentType: 'weekly_review',
          userRequest: adjustmentRequest || 'Adjust based on my weekly feedback and run data',
          weeklyFeedback: {
            overallFeeling: overallFeeling[0],
            sleepQuality: sleepQuality[0],
            stressLevel: stressLevel[0],
            injuryNotes,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to adjust plan');
      }

      setAdjustmentResult({
        summary: data.adjustment?.adjustment_summary,
        recommendations: data.adjustment?.recommendations,
        warnings: data.adjustment?.warnings,
        planUpdated: data.planUpdated,
      });

      if (data.planUpdated) {
        fetchActivePlan();
      }
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Failed to adjust plan');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="rc-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
          WEEKLY REVIEW
        </div>
        <h1
          className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
          style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
        >
          Reflect on{' '}
          <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--rc-ink-2)' }}>
            this week.
          </span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--rc-ink-3)' }}>
          Rate your training week and get AI-powered insights.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* This Week's Runs */}
        <div className="rc-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
            <div>
              <div className="rc-kicker mb-1">{getWeekDateRange()}</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>This week&apos;s runs</h3>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
              <Calendar className="w-4 h-4" />
            </div>
          </div>

          {runsLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
              ))}
            </div>
          ) : weeklyRuns.length > 0 ? (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3 px-6 pt-5 pb-4">
                {[
                  { label: 'RUNS', value: weeklyRuns.length, unit: '', accent: 'var(--rc-blue)' },
                  { label: 'DISTANCE', value: totalDistance.toFixed(1), unit: 'km', accent: 'var(--rc-amber)' },
                  { label: 'DURATION', value: Math.round(totalDuration), unit: 'min', accent: 'var(--rc-purple)' },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="relative overflow-hidden rounded-xl p-4 text-center"
                    style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}
                  >
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: s.accent }} />
                    <div className="rc-kicker mb-1.5">{s.label}</div>
                    <div className="text-[22px] font-bold" style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                      {s.value}
                      {s.unit && <span className="text-[11px] font-medium ml-1" style={{ color: 'var(--rc-ink-3)' }}>{s.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Run List */}
              {weeklyRuns.map((run, idx) => (
                <div
                  key={run.id}
                  className="grid items-center gap-4 px-6 py-3.5"
                  style={{
                    gridTemplateColumns: '36px 1fr auto',
                    borderTop: '1px solid var(--rc-line)',
                  }}
                >
                  <div className="w-9 h-9 rounded-[10px] grid place-items-center" style={{ background: 'oklch(0.96 0.04 240)', color: 'var(--rc-blue-deep)' }}>
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold" style={{ letterSpacing: '-0.005em', color: 'var(--rc-ink)' }}>
                      {run.workout_name || run.run_type || 'Run'}
                    </div>
                    <div className="rc-mono text-[11px] uppercase mt-0.5" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>
                      {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} · {new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="rc-mono font-semibold text-[15px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                      {run.distance_km?.toFixed(1)}<span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--rc-ink-3)' }}>km</span>
                    </div>
                    <div className="rc-mono text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>{run.avg_pace_str || '-'}</div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--rc-ink-3)' }}>
              <Calendar className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
              <p className="text-sm font-medium">No runs this week yet</p>
              <p className="text-xs mt-1">Sync from Strava or log a run manually.</p>
            </div>
          )}
        </div>

        {/* Weekly Check-in Form */}
        <div className="rc-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
            <div>
              <div className="rc-kicker mb-1">Check-in</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Weekly check-in</h3>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-good-soft)', color: 'oklch(0.42 0.10 150)' }}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="p-6 space-y-6">
            {/* Sliders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-6">
                {/* Overall Feeling */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Overall Feeling</label>
                    <span className="rc-mono text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
                      {overallFeeling[0]}/10
                    </span>
                  </div>
                  <Slider value={overallFeeling} onValueChange={setOverallFeeling} max={10} min={1} step={1} />
                  <div className="flex justify-between text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>
                    <span>Poor</span><span>Excellent</span>
                  </div>
                </div>

                {/* Sleep Quality */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Sleep Quality</label>
                    <span className="rc-mono text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
                      {sleepQuality[0]}/10
                    </span>
                  </div>
                  <Slider value={sleepQuality} onValueChange={setSleepQuality} max={10} min={1} step={1} />
                  <div className="flex justify-between text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>
                    <span>Poor</span><span>Excellent</span>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* Stress Level */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Stress Level</label>
                    <span className="rc-mono text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
                      {stressLevel[0]}/10
                    </span>
                  </div>
                  <Slider value={stressLevel} onValueChange={setStressLevel} max={10} min={1} step={1} />
                  <div className="flex justify-between text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>
                    <span>Low</span><span>High</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Injury Notes */}
            <div className="space-y-3">
              <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Injuries / Niggles</label>
              <textarea
                value={injuryNotes}
                onChange={(e) => setInjuryNotes(e.target.value)}
                placeholder="Any pain or discomfort..."
                rows={2}
                className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
              />
            </div>

            {/* Achievements */}
            <div className="space-y-3">
              <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Achievements</label>
              <textarea
                value={achievements}
                onChange={(e) => setAchievements(e.target.value)}
                placeholder="What went well this week..."
                rows={2}
                className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
                style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl text-sm" style={{ background: 'oklch(0.95 0.05 25)', color: 'var(--rc-bad)', border: '1px solid oklch(0.90 0.08 25)' }}>
                {error}
              </div>
            )}

            {/* Analyze Button */}
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'var(--rc-blue)', color: '#fff' }}
            >
              <Brain className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Analyzing...' : 'Get AI Analysis'}
            </button>
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      {(aiAnalysis || loading) && (
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
            <div className="rc-kicker mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <Brain className={`w-4 h-4 inline mr-2 ${loading ? 'animate-pulse' : ''}`} />
              COACH&apos;S ANALYSIS
            </div>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-4" style={{ background: 'rgba(255,255,255,0.08)', width: `${90 - i * 10}%` }} />
                ))}
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {aiAnalysis}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plan Adjustment */}
      {activePlan && (
        <div className="rc-card relative overflow-hidden p-6">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: 'var(--rc-amber)' }} />
          <div className="flex items-center gap-3 mb-4">
            <div className={`p-2.5 rounded-xl ${adjusting ? 'animate-pulse' : ''}`} style={{ background: 'oklch(0.96 0.05 75)', color: 'oklch(0.50 0.13 75)' }}>
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[17px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Adjust Training Plan</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--rc-ink-3)' }}>
                <span className="rc-mono text-[10.5px] px-2 py-0.5 rounded-[5px] mr-2" style={{ background: 'oklch(0.96 0.05 75)', color: 'oklch(0.50 0.13 75)', letterSpacing: '0.06em' }}>
                  {activePlan.plan_type} · WK {activePlan.current_week_num}/{activePlan.duration_weeks}
                </span>
                AI coach can modify your remaining weeks.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <textarea
              value={adjustmentRequest}
              onChange={(e) => setAdjustmentRequest(e.target.value)}
              placeholder="e.g., 'I have a work trip next week, need lighter training'..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
              style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}
            />

            {adjustmentError && (
              <div className="p-3 rounded-xl text-sm" style={{ background: 'oklch(0.95 0.05 25)', color: 'var(--rc-bad)' }}>
                {adjustmentError}
              </div>
            )}

            <button
              onClick={handleAdjustPlan}
              disabled={adjusting}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'var(--rc-amber)', color: '#fff' }}
            >
              <Wand2 className="w-4 h-4" />
              {adjusting ? 'Adjusting Plan...' : 'Adjust My Plan'}
            </button>

            {adjustmentResult && (
              <div className="space-y-3 p-4 rounded-xl" style={{ background: 'oklch(0.96 0.05 75)', border: '1px solid oklch(0.90 0.08 75)' }}>
                {adjustmentResult.planUpdated && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--rc-good)' }}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold text-sm">Plan Updated!</span>
                  </div>
                )}
                {adjustmentResult.summary && (
                  <div>
                    <div className="rc-kicker mb-1.5">Summary</div>
                    <p className="text-sm" style={{ color: 'var(--rc-ink-2)' }}>{adjustmentResult.summary}</p>
                  </div>
                )}
                {adjustmentResult.recommendations && adjustmentResult.recommendations.length > 0 && (
                  <div>
                    <div className="rc-kicker mb-1.5">Changes</div>
                    <ul className="text-sm space-y-1" style={{ color: 'var(--rc-ink-2)' }}>
                      {adjustmentResult.recommendations.map((rec, i) => (
                        <li key={i} className="flex gap-2"><span style={{ color: 'var(--rc-ink-4)' }}>·</span> {rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {adjustmentResult.warnings && adjustmentResult.warnings.length > 0 && (
                  <div className="p-3 rounded-lg" style={{ background: 'oklch(0.95 0.06 75)' }}>
                    <div className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--rc-amber)' }}>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span className="rc-kicker" style={{ color: 'var(--rc-amber)' }}>WARNINGS</span>
                    </div>
                    <ul className="text-xs space-y-1" style={{ color: 'oklch(0.50 0.13 75)' }}>
                      {adjustmentResult.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Week Summary */}
      {weeklyRuns.length > 0 && (
        <div>
          <div className="rc-kicker mb-4">WEEK SUMMARY</div>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {[
              { label: 'Total runs', value: weeklyRuns.length, unit: '', accent: 'var(--rc-blue)' },
              { label: 'Total distance', value: totalDistance.toFixed(1), unit: 'km', accent: 'var(--rc-good)' },
              { label: 'Avg distance', value: (totalDistance / weeklyRuns.length).toFixed(1), unit: 'km', accent: 'var(--rc-purple)' },
              {
                label: 'Avg HR',
                value: weeklyRuns.filter(r => r.avg_hr).length > 0
                  ? Math.round(weeklyRuns.reduce((sum, r) => sum + (r.avg_hr || 0), 0) / weeklyRuns.filter(r => r.avg_hr).length)
                  : '-',
                unit: weeklyRuns.filter(r => r.avg_hr).length > 0 ? 'bpm' : '',
                accent: 'var(--rc-bad)',
              },
            ].map((card) => (
              <div key={card.label} className="rc-card relative overflow-hidden p-5">
                <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: card.accent }} />
                <div className="rc-kicker mb-2">{card.label}</div>
                <div className="text-[28px] font-bold" style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                  {card.value}
                  {card.unit && <span className="text-[12px] font-medium ml-1" style={{ color: 'var(--rc-ink-3)' }}>{card.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
