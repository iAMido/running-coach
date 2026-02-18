'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
  const [generating, setGenerating] = useState(false);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewingWeek, setViewingWeek] = useState(1); // Week being viewed (can be different from current)
  const [calculatedCurrentWeek, setCalculatedCurrentWeek] = useState(1); // Actual current week based on date
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('generate');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
          // Use calculated current week from API
          const currentWeek = data.plan.current_week_num || 1;
          setCalculatedCurrentWeek(currentWeek);
          setViewingWeek(currentWeek); // Start viewing the current week
          setActiveTab('current');
        }
      }
    } catch (err) {
      console.error('Failed to fetch plan:', err);
    } finally {
      setLoading(false);
    }
  };

  // Jump to current week
  const jumpToCurrentWeek = () => {
    setViewingWeek(calculatedCurrentWeek);
  };

  // Check if currently viewing the actual current week
  const isViewingCurrentWeek = viewingWeek === calculatedCurrentWeek;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/coach/plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: planTypes.find(p => p.value === planType)?.label || planType,
          durationWeeks: parseInt(duration),
          runsPerWeek: parseInt(runsPerWeek),
          notes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate plan');
      }

      setActivePlan(data.plan);
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

    // Handle different plan JSON structures
    if (planJson.weeks && Array.isArray(planJson.weeks)) {
      return planJson.weeks;
    }

    // If it's a raw response, return empty
    if (planJson.raw_response) {
      return [];
    }

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="coach-heading text-3xl tracking-tight">Training Plan</h1>
        <p className="text-muted-foreground mt-2">
          Generate and manage your AI-powered training plan.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="current" disabled={!activePlan}>
              Current Plan
            </TabsTrigger>
            <TabsTrigger value="generate">Generate New</TabsTrigger>
          </TabsList>

          {/* Current Plan */}
          <TabsContent value="current" className="space-y-6">
            {activePlan ? (
              <>
                {/* Plan Header */}
                <Card className="coach-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="coach-heading flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-gradient-to-br from-primary/15 to-secondary/15">
                            <Target className="w-5 h-5 text-primary" />
                          </div>
                          {activePlan.plan_type}
                        </CardTitle>
                        <CardDescription className="mt-2">
                          Currently on Week {calculatedCurrentWeek} of {totalWeeks}
                          {activePlan.week_info?.weekDateRange && ` (${activePlan.week_info.weekDateRange})`}
                          {activePlan.week_info?.daysRemaining !== undefined && activePlan.week_info.daysRemaining > 0 && (
                            <span className="ml-2 text-muted-foreground">
                              {activePlan.week_info.daysRemaining} days remaining
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge variant="outline" className={`px-3 py-1 ${
                          activePlan.isAfterEnd
                            ? 'text-amber-600 border-amber-600 bg-amber-500/10'
                            : 'text-green-600 border-green-600 bg-green-500/10'
                        }`}>
                          {activePlan.isAfterEnd ? 'Completed' : 'Active'}
                        </Badge>
                        {!isViewingCurrentWeek && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={jumpToCurrentWeek}
                            className="text-xs"
                          >
                            <Home className="w-3 h-3 mr-1" />
                            Current Week
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Week Navigation */}
                <Card className="coach-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <button
                        className="week-nav-button"
                        disabled={viewingWeek <= 1}
                        onClick={() => setViewingWeek(w => w - 1)}
                        aria-label="Previous week"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <div className="text-center">
                        <CardTitle className="coach-heading flex items-center justify-center gap-2">
                          Week {viewingWeek}
                          {isViewingCurrentWeek && (
                            <Badge variant="default" className="text-[10px] py-0 px-1.5 bg-primary">Current</Badge>
                          )}
                        </CardTitle>
                        <CardDescription>{getWeekDateRange(viewingWeek)}</CardDescription>
                      </div>
                      <button
                        className="week-nav-button"
                        disabled={viewingWeek >= totalWeeks}
                        onClick={() => setViewingWeek(w => w + 1)}
                        aria-label="Next week"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {weekData?.focus && (
                      <p className="text-sm text-muted-foreground mb-4 text-center bg-gradient-to-r from-primary/5 to-secondary/5 py-2 px-4 rounded-lg">
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
                      <div className="prose dark:prose-invert max-w-none text-sm">
                        <pre className="whitespace-pre-wrap text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96 scrollable-list">
                          {activePlan.plan_json.raw_response}
                        </pre>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <Calendar className="empty-state-icon" />
                        <p className="font-medium">No workout details available for this week.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Strength Training Section */}
                <StrengthWorkout
                  weekNumber={viewingWeek}
                  totalWeeks={totalWeeks}
                />
              </>
            ) : (
              <Card className="coach-card">
                <CardContent className="py-12">
                  <div className="empty-state">
                    <Target className="empty-state-icon" />
                    <p className="font-medium">No active training plan.</p>
                    <p className="text-sm mt-1">
                      Generate a new plan to get started.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Generate New Plan */}
          <TabsContent value="generate">
            <Card className="coach-card">
              <CardHeader>
                <CardTitle className="coach-heading flex items-center gap-2">
                  <div className={`ai-icon-container p-2 rounded-lg bg-gradient-to-br from-primary/15 to-secondary/15 ${generating ? 'active ai-pulse' : ''}`}>
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  Generate Training Plan
                </CardTitle>
                <CardDescription>
                  Create a personalized plan based on the Run Elite Triphasic methodology.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {successMessage && (
                  <div className="p-3 rounded-lg bg-green-500/10 text-green-600 text-sm border border-green-500/20 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {successMessage}
                  </div>
                )}
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm border border-red-500/20">
                    {error}
                  </div>
                )}

                {/* Plan Type */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Plan Type</label>
                  <Select value={planType} onValueChange={setPlanType}>
                    <SelectTrigger className="coach-select-trigger">
                      <SelectValue placeholder="Select plan type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {planTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Duration */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Duration (weeks)</label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger className="coach-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durationOptions.map((weeks) => (
                        <SelectItem key={weeks} value={weeks.toString()}>
                          {weeks} weeks
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Runs per Week */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Runs per Week</label>
                  <Select value={runsPerWeek} onValueChange={setRunsPerWeek}>
                    <SelectTrigger className="coach-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {runsPerWeekOptions.map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} runs/week
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Additional Notes</label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any specific goals, constraints, or preferences..."
                    rows={3}
                    className="coach-input-focus"
                  />
                </div>

                {/* Generate Button */}
                <Button
                  onClick={handleGenerate}
                  className="w-full btn-gradient-primary coach-button-accessible"
                  disabled={!planType || generating}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {generating ? 'Generating Plan...' : 'Generate Plan'}
                </Button>

                {generating && (
                  <p className="text-sm text-center text-muted-foreground animate-pulse">
                    Creating your personalized plan...
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
