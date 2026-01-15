'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardList, CheckCircle, Save } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Run } from '@/lib/db/types';

const feelingOptions = ['Great', 'Good', 'Okay', 'Tired', 'Exhausted'];

export default function LogRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState([5]);
  const [effort, setEffort] = useState([5]);
  const [feeling, setFeeling] = useState('');
  const [comment, setComment] = useState('');
  const [selectedRun, setSelectedRun] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchRuns();
  }, []);

  const fetchRuns = async () => {
    try {
      const response = await fetch('/api/coach/runs?limit=30');
      const data = await response.json();
      setRuns(data.runs || []);
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSelectedRunData = () => {
    return runs.find(r => r.id === selectedRun);
  };

  const handleSubmit = async () => {
    if (!selectedRun) return;

    const runData = getSelectedRunData();
    if (!runData) return;

    setSubmitting(true);
    setSubmitted(false);

    try {
      const response = await fetch('/api/coach/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_date: runData.date,
          rating: rating[0],
          effort_level: effort[0],
          feeling,
          comment,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        // Reset form
        setRating([5]);
        setEffort([5]);
        setFeeling('');
        setComment('');
        setSelectedRun('');
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Runs</h1>
        <p className="text-muted-foreground mt-1">
          Record your post-run feedback and ratings.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Run Selector */}
        <Card>
          <CardHeader>
            <CardTitle>Select Run</CardTitle>
            <CardDescription>Choose a recent run to log feedback for</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : runs.length > 0 ? (
              <>
                <Select value={selectedRun} onValueChange={setSelectedRun}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a run..." />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {new Date(run.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })} - {run.distance_km.toFixed(1)} km
                        {run.workout_name && ` (${run.workout_name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedRun && (
                  <div className="mt-4 p-3 rounded-lg bg-accent">
                    {(() => {
                      const run = getSelectedRunData();
                      if (!run) return null;
                      return (
                        <div className="text-sm space-y-1">
                          <p className="font-medium">{run.workout_name || 'Run'}</p>
                          <p className="text-muted-foreground">
                            {run.distance_km.toFixed(2)} km in {run.duration_min} min
                            {run.avg_pace_str && ` • ${run.avg_pace_str}/km`}
                          </p>
                          {run.avg_hr && (
                            <p className="text-muted-foreground">
                              Avg HR: {run.avg_hr} bpm
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-8 text-center py-8 text-muted-foreground">
                <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No runs available to log.</p>
                <p className="text-sm mt-1">
                  Sync from Strava to see your recent runs.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Feedback Form */}
        <Card>
          <CardHeader>
            <CardTitle>Run Feedback</CardTitle>
            <CardDescription>How did the run feel?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Rating */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-sm font-medium">Overall Rating</label>
                <span className="text-sm text-muted-foreground">{rating[0]}/10</span>
              </div>
              <Slider
                value={rating}
                onValueChange={setRating}
                max={10}
                min={1}
                step={1}
                className="w-full"
              />
            </div>

            {/* Effort */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-sm font-medium">Effort Level (RPE)</label>
                <span className="text-sm text-muted-foreground">{effort[0]}/10</span>
              </div>
              <Slider
                value={effort}
                onValueChange={setEffort}
                max={10}
                min={1}
                step={1}
                className="w-full"
              />
            </div>

            {/* Feeling */}
            <div className="space-y-3">
              <label className="text-sm font-medium">How did you feel?</label>
              <Select value={feeling} onValueChange={setFeeling}>
                <SelectTrigger>
                  <SelectValue placeholder="Select feeling..." />
                </SelectTrigger>
                <SelectContent>
                  {feelingOptions.map((opt) => (
                    <SelectItem key={opt} value={opt.toLowerCase()}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Comment */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Any notes about the run..."
                rows={3}
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              className="w-full bg-gradient-to-r from-blue-500 to-green-500 text-white"
              disabled={!selectedRun || submitting}
            >
              {submitted ? (
                <CheckCircle className="w-4 h-4 mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {submitting ? 'Saving...' : submitted ? 'Saved!' : 'Save Feedback'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
