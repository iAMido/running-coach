'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardList, CheckCircle, Save, Activity } from 'lucide-react';
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
        <h1 className="coach-heading text-3xl tracking-tight">Log Runs</h1>
        <p className="text-muted-foreground mt-2">
          Record your post-run feedback and ratings.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Run Selector */}
        <Card className="coach-card lg:row-span-2">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <ClipboardList className="w-4 h-4 text-primary" />
              </div>
              Select Run
            </CardTitle>
            <CardDescription>Choose a recent run to log feedback for</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : runs.length > 0 ? (
              <div className="scrollable-list space-y-2 pr-2" style={{ maxHeight: '500px' }}>
                {runs.map((run) => (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRun(run.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedRun(run.id)}
                    className={`run-list-item flex items-center justify-between cursor-pointer touch-target-min ${
                      selectedRun === run.id ? 'selected' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl transition-colors ${
                        selectedRun === run.id
                          ? 'bg-gradient-to-br from-primary/30 to-secondary/30'
                          : 'bg-gradient-to-br from-primary/15 to-secondary/15'
                      }`}>
                        <Activity className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">{run.workout_name || 'Run'}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(run.date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="metric-value text-lg font-bold">{run.distance_km.toFixed(1)} km</p>
                      <p className="text-sm text-muted-foreground font-mono">{run.avg_pace_str || '-'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <ClipboardList className="empty-state-icon" />
                <p className="font-medium">No runs available to log</p>
                <p className="text-sm mt-1">
                  Sync from Strava to see your recent runs.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Feedback Form */}
        <Card className="coach-card">
          <CardHeader>
            <CardTitle className="coach-heading text-xl flex items-center gap-2">
              <div className="p-2 rounded-lg bg-secondary/10">
                <Save className="w-4 h-4 text-secondary" />
              </div>
              Run Feedback
            </CardTitle>
            <CardDescription>How did the run feel?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Rating */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Overall Rating</label>
                <span className="metric-value text-sm font-bold">{rating[0]}/10</span>
              </div>
              <Slider
                value={rating}
                onValueChange={setRating}
                max={10}
                min={1}
                step={1}
                className="coach-slider touch-target-min"
              />
            </div>

            {/* Effort */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Effort Level (RPE)</label>
                <span className="metric-value text-sm font-bold">{effort[0]}/10</span>
              </div>
              <Slider
                value={effort}
                onValueChange={setEffort}
                max={10}
                min={1}
                step={1}
                className="coach-slider touch-target-min"
              />
            </div>

            {/* Feeling */}
            <div className="space-y-3">
              <label className="text-sm font-medium">How did you feel?</label>
              <Select value={feeling} onValueChange={setFeeling}>
                <SelectTrigger className="coach-select-trigger">
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
                className="coach-input-focus"
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              className="w-full btn-gradient-primary coach-button-accessible"
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
