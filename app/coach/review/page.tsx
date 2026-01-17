'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Brain, Activity, TrendingUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Run } from '@/lib/db/types';

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

  useEffect(() => {
    fetchWeeklyRuns();
  }, []);

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
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="coach-heading text-2xl md:text-3xl tracking-tight">Weekly Review</h1>
        <p className="text-muted-foreground mt-1 md:mt-2 text-sm md:text-base">
          Reflect on your training week and get AI-powered insights.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* This Week's Runs */}
        <Card className="coach-card">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              This Week&apos;s Runs
            </CardTitle>
            <CardDescription>{getWeekDateRange()}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : weeklyRuns.length > 0 ? (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-gradient-to-r from-blue-500/5 to-green-500/5 rounded-xl border border-border/50">
                  <div className="text-center">
                    <p className="metric-value text-2xl">{weeklyRuns.length}</p>
                    <p className="metric-label text-xs">Runs</p>
                  </div>
                  <div className="text-center">
                    <p className="metric-value text-2xl">{totalDistance.toFixed(1)}</p>
                    <p className="metric-label text-xs">km</p>
                  </div>
                  <div className="text-center">
                    <p className="metric-value text-2xl">{Math.round(totalDuration)}</p>
                    <p className="metric-label text-xs">min</p>
                  </div>
                </div>

                {/* Run List */}
                <div className="space-y-2">
                  {weeklyRuns.map((run) => (
                    <div
                      key={run.id}
                      className="run-list-item flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
                          <Activity className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{run.workout_name || run.run_type || 'Run'}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="metric-value text-sm">{run.distance_km?.toFixed(1)} km</p>
                        <p className="text-xs text-muted-foreground font-mono">{run.avg_pace_str || '-'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Calendar className="empty-state-icon" />
                <p className="font-medium">No runs this week yet</p>
                <p className="text-sm mt-1">
                  Sync from Strava or log a run manually.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weekly Check-in Form */}
        <Card className="coach-card">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className="p-2 rounded-lg bg-secondary/10">
                <TrendingUp className="w-4 h-4 text-secondary" />
              </div>
              Weekly Check-in
            </CardTitle>
            <CardDescription>Rate your week on each metric (1-10)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sliders - 2 column layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-6">
                {/* Overall Feeling */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium">Overall Feeling</label>
                    <span className="metric-value text-sm font-bold bg-primary/10 px-2 py-1 rounded">{overallFeeling[0]}/10</span>
                  </div>
                  <Slider
                    value={overallFeeling}
                    onValueChange={setOverallFeeling}
                    max={10}
                    min={1}
                    step={1}
                    className="coach-slider touch-target-min"
                  />
                  <div className="flex justify-between text-xs md:text-sm text-muted-foreground">
                    <span>Poor</span>
                    <span>Excellent</span>
                  </div>
                </div>

                {/* Sleep Quality */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium">Sleep Quality</label>
                    <span className="metric-value text-sm font-bold bg-primary/10 px-2 py-1 rounded">{sleepQuality[0]}/10</span>
                  </div>
                  <Slider
                    value={sleepQuality}
                    onValueChange={setSleepQuality}
                    max={10}
                    min={1}
                    step={1}
                    className="coach-slider touch-target-min"
                  />
                  <div className="flex justify-between text-xs md:text-sm text-muted-foreground">
                    <span>Poor</span>
                    <span>Excellent</span>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                {/* Stress Level */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium">Stress Level</label>
                    <span className="metric-value text-sm font-bold bg-primary/10 px-2 py-1 rounded">{stressLevel[0]}/10</span>
                  </div>
                  <Slider
                    value={stressLevel}
                    onValueChange={setStressLevel}
                    max={10}
                    min={1}
                    step={1}
                    className="coach-slider touch-target-min"
                  />
                  <div className="flex justify-between text-xs md:text-sm text-muted-foreground">
                    <span>Low</span>
                    <span>High</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Injury Notes */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Injuries / Niggles</label>
              <Textarea
                value={injuryNotes}
                onChange={(e) => setInjuryNotes(e.target.value)}
                placeholder="Any pain or discomfort..."
                rows={2}
              />
            </div>

            {/* Achievements */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Achievements</label>
              <Textarea
                value={achievements}
                onChange={(e) => setAchievements(e.target.value)}
                placeholder="What went well this week..."
                rows={2}
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm border border-red-500/20">
                {error}
              </div>
            )}

            {/* Analyze Button */}
            <Button
              onClick={handleAnalyze}
              className="w-full btn-gradient-primary coach-button-accessible"
              disabled={loading}
            >
              <div className={`ai-icon-container ${loading ? 'active' : ''}`}>
                <Brain className="w-4 h-4 mr-2" />
              </div>
              {loading ? 'Analyzing...' : 'Get AI Analysis'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis */}
      {(aiAnalysis || loading) && (
        <Card className="coach-card">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className={`ai-icon-container p-2 rounded-lg bg-gradient-to-br from-primary/15 to-secondary/15 ${loading ? 'active ai-pulse' : ''}`}>
                <Brain className="w-5 h-5 text-primary" />
              </div>
              Coach&apos;s Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : (
              <div className="prose dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gradient-to-br from-primary/5 to-secondary/5 p-4 rounded-lg border border-border/50">{aiAnalysis}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Weekly Trend */}
      {weeklyRuns.length > 0 && (
        <Card className="coach-card">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              Week Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:gap-4 md:grid-cols-4">
              <div className="text-center p-3 md:p-4 bg-gradient-to-br from-blue-500/5 to-green-500/5 rounded-xl border border-border/50">
                <p className="metric-value text-2xl md:text-3xl">{weeklyRuns.length}</p>
                <p className="metric-label text-xs md:text-sm">Total Runs</p>
              </div>
              <div className="text-center p-3 md:p-4 bg-gradient-to-br from-blue-500/5 to-green-500/5 rounded-xl border border-border/50">
                <p className="metric-value text-2xl md:text-3xl">{totalDistance.toFixed(1)}</p>
                <p className="metric-label text-xs md:text-sm">Total km</p>
              </div>
              <div className="text-center p-3 md:p-4 bg-gradient-to-br from-blue-500/5 to-green-500/5 rounded-xl border border-border/50">
                <p className="metric-value text-2xl md:text-3xl">
                  {weeklyRuns.length > 0 ? (totalDistance / weeklyRuns.length).toFixed(1) : 0}
                </p>
                <p className="metric-label text-xs md:text-sm">Avg Dist</p>
              </div>
              <div className="text-center p-3 md:p-4 bg-gradient-to-br from-blue-500/5 to-green-500/5 rounded-xl border border-border/50">
                <p className="metric-value text-2xl md:text-3xl">
                  {weeklyRuns.filter(r => r.avg_hr).length > 0
                    ? Math.round(weeklyRuns.reduce((sum, r) => sum + (r.avg_hr || 0), 0) / weeklyRuns.filter(r => r.avg_hr).length)
                    : '-'}
                </p>
                <p className="metric-label text-xs md:text-sm">Avg HR</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
