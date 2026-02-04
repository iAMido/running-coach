'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Activity, Flame, ChevronDown, ChevronUp, Timer, Target, Zap } from 'lucide-react';
import type { Workout } from '@/lib/db/types';

// Helper function to get workout tag class based on workout type
export const getWorkoutTagClass = (type: string | undefined): string => {
  if (!type) return 'workout-tag workout-tag-easy';
  const lowerType = type.toLowerCase();
  if (lowerType.includes('easy') || lowerType.includes('recovery')) return 'workout-tag workout-tag-easy';
  if (lowerType.includes('tempo') || lowerType.includes('threshold')) return 'workout-tag workout-tag-tempo';
  if (lowerType.includes('interval') || lowerType.includes('speed') || lowerType.includes('fartlek')) return 'workout-tag workout-tag-interval';
  if (lowerType.includes('long')) return 'workout-tag workout-tag-long';
  if (lowerType.includes('rest') || lowerType.includes('off')) return 'workout-tag workout-tag-rest';
  return 'workout-tag workout-tag-easy';
};

interface WorkoutCardProps {
  day: string;
  workout: Workout;
  isToday?: boolean;
  variant?: 'card' | 'row';
}

export function WorkoutCard({ day, workout, isToday = false, variant = 'card' }: WorkoutCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Check if there's detailed content to show
  const hasDetails = workout.description || workout.notes;

  if (variant === 'row') {
    // Table row variant for Dashboard
    return (
      <>
        <tr
          onClick={() => hasDetails && setExpanded(!expanded)}
          className={`border-b last:border-0 transition-colors ${
            isToday
              ? 'bg-gradient-to-r from-primary/10 to-secondary/10 border-l-4 border-l-primary'
              : 'hover:bg-accent/50'
          } ${hasDetails ? 'cursor-pointer' : ''}`}
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
              {workout.type || 'Workout'}
            </Badge>
          </td>
          <td className={`py-3 px-2 ${isToday ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            {workout.distance || workout.duration || '-'}
          </td>
          <td className="py-3 px-2 text-muted-foreground hidden md:table-cell">
            {workout.target_pace || workout.target_hr || '-'}
          </td>
          <td className="py-3 px-2 text-muted-foreground hidden lg:table-cell">
            {hasDetails ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-primary">
                  {expanded ? 'Hide' : 'View'} details
                </span>
                {expanded ? (
                  <ChevronUp className="w-4 h-4 text-primary" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-primary" />
                )}
              </div>
            ) : (
              '-'
            )}
          </td>
        </tr>
        {expanded && hasDetails && (
          <tr className={isToday ? 'bg-primary/5' : 'bg-muted/30'}>
            <td colSpan={5} className="px-4 py-3">
              <div className="space-y-2">
                {workout.description && (
                  <div className="bg-background/80 rounded-lg p-3 border border-border/50">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Workout Instructions:</p>
                    <p className="text-sm whitespace-pre-wrap">{workout.description}</p>
                  </div>
                )}
                {workout.notes && (
                  <div className="bg-background/80 rounded-lg p-3 border border-border/50">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notes:</p>
                    <p className="text-sm italic">{workout.notes}</p>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  // Card variant for Plan page
  return (
    <div
      className={`week-workout-card ${
        isToday ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      } ${hasDetails ? 'cursor-pointer' : ''}`}
      onClick={() => hasDetails && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl mt-0.5 ${
          isToday
            ? 'bg-gradient-to-br from-primary to-secondary'
            : 'bg-gradient-to-br from-primary/15 to-secondary/15'
        }`}>
          <Activity className={`w-4 h-4 ${isToday ? 'text-white' : 'text-primary'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <p className="font-semibold">{day}</p>
              {isToday && (
                <Badge variant="default" className="text-[10px] py-0 px-1.5 bg-primary pulse-badge">
                  <Flame className="w-3 h-3 mr-0.5" />
                  Today
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {workout.distance && (
                <span className="metric-value text-sm font-bold">
                  {workout.distance}
                </span>
              )}
              {hasDetails && (
                <div className="text-muted-foreground">
                  {expanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              )}
            </div>
          </div>
          <span className={getWorkoutTagClass(workout.type)}>
            {workout.type || 'Workout'}
          </span>

          {/* Basic info always visible */}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
            {workout.duration && (
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {workout.duration}
              </span>
            )}
            {workout.target_pace && (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {workout.target_pace}
              </span>
            )}
            {workout.target_hr && (
              <span className="flex items-center gap-1">
                <Target className="w-3 h-3" />
                {workout.target_hr}
              </span>
            )}
          </div>

          {/* Expanded details */}
          {expanded && hasDetails && (
            <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
              {workout.description && (
                <div className="bg-muted/50 rounded-lg p-3 border border-border/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Workout Instructions:</p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{workout.description}</p>
                </div>
              )}
              {workout.notes && (
                <div className="bg-muted/50 rounded-lg p-3 border border-border/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes:</p>
                  <p className="text-sm italic">{workout.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Show hint if there are details but not expanded */}
          {!expanded && hasDetails && (
            <p className="text-xs text-primary mt-2 flex items-center gap-1">
              <span>Tap to see workout details</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
