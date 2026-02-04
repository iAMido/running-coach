'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dumbbell, ChevronDown, ChevronUp, Play, Clock, Info } from 'lucide-react';
import type { WeeklyStrength } from '@/lib/db/types';

interface StrengthWorkoutProps {
  weekNumber: number;
  totalWeeks: number;
}

const categoryColors: Record<string, string> = {
  core: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  lower_body: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  upper_body: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  mobility: 'bg-green-500/15 text-green-700 dark:text-green-300',
};

const equipmentIcons: Record<string, string> = {
  bodyweight: 'BW',
  dumbbell: 'DB',
  band: 'Band',
  wheel: 'Wheel',
  bar: 'Bar',
};

const phaseLabels: Record<string, { label: string; color: string }> = {
  base: { label: 'Foundation', color: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30' },
  build: { label: 'Strength', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  specific: { label: 'Power', color: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30' },
};

export function StrengthWorkout({ weekNumber, totalWeeks }: StrengthWorkoutProps) {
  const [strengthData, setStrengthData] = useState<WeeklyStrength | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);

  useEffect(() => {
    fetchStrengthWorkout();
  }, [weekNumber, totalWeeks]);

  const fetchStrengthWorkout = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/coach/strength?week=${weekNumber}&totalWeeks=${totalWeeks}`);
      if (!response.ok) {
        throw new Error('Failed to fetch strength workout');
      }
      const data = await response.json();
      setStrengthData(data.strength);
    } catch (err) {
      console.error('Error fetching strength workout:', err);
      setError('Could not load strength workout');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="coach-card strength-card mt-6">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !strengthData) {
    return null; // Silently hide if strength data unavailable
  }

  const phaseInfo = phaseLabels[strengthData.phase] || phaseLabels.base;

  return (
    <Card className="coach-card strength-card mt-6 border-purple-500/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex-shrink-0">
                  <Dumbbell className="w-5 h-5 text-purple-500" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="coach-heading text-lg">
                    Weekly Strength
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="outline" className={`text-xs ${phaseInfo.color}`}>
                      {phaseInfo.label}
                    </Badge>
                    <CardDescription className="flex items-center gap-1.5 text-xs">
                      <Clock className="w-3 h-3" />
                      {strengthData.duration_minutes} min
                      <span className="text-muted-foreground mx-0.5">•</span>
                      {strengthData.exercises.length} exercises
                    </CardDescription>
                  </div>
                </div>
              </div>
              <div className="flex items-center text-muted-foreground flex-shrink-0 mt-1">
                {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {strengthData.notes && (
              <div className="mb-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/10 text-sm text-muted-foreground">
                <Info className="w-4 h-4 inline mr-2 text-purple-500" />
                {strengthData.notes}
              </div>
            )}

            <div className="space-y-2">
              {strengthData.exercises.map((exercise, index) => (
                <div
                  key={exercise.id}
                  className="strength-exercise-card group"
                >
                  <div
                    className="flex items-start gap-3 cursor-pointer"
                    onClick={() => setExpandedExercise(expandedExercise === exercise.id ? null : exercise.id)}
                  >
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-sm font-semibold text-purple-600 dark:text-purple-400 mt-0.5">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Exercise name - full width, no truncation */}
                      <h4 className="font-medium text-sm leading-tight">{exercise.name}</h4>
                      {/* Equipment + Sets/Reps on second row */}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className={`text-xs px-1.5 py-0 ${categoryColors[exercise.category] || ''}`}>
                          {equipmentIcons[exercise.equipment] || exercise.equipment}
                        </Badge>
                        <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                          {exercise.sets_reps}
                        </span>
                      </div>
                    </div>
                    {exercise.youtube_url && (
                      <a
                        href={exercise.youtube_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-2 rounded-full bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        title="Watch tutorial"
                      >
                        <Play className="w-4 h-4 text-red-500" />
                      </a>
                    )}
                  </div>

                  {expandedExercise === exercise.id && (
                    <div className="mt-3 pl-10 space-y-2 text-sm text-muted-foreground animate-in slide-in-from-top-2 duration-200">
                      {exercise.description && (
                        <p className="text-xs">{exercise.description}</p>
                      )}
                      {exercise.coaching_cues && exercise.coaching_cues.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-foreground">Form Cues:</p>
                          <ul className="list-disc list-inside text-xs space-y-0.5">
                            {exercise.coaching_cues.map((cue, i) => (
                              <li key={i}>{cue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground text-center">
              Complete this workout once per week on a non-running day or after an easy run.
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
