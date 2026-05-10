'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ClipboardList, CheckCircle, Save, Activity, X } from 'lucide-react';
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
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

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
        setRating([5]);
        setEffort([5]);
        setFeeling('');
        setComment('');
        setSelectedRun('');
        setMobileSheetOpen(false);
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunSelect = (runId: string) => {
    setSelectedRun(runId);
    if (window.innerWidth < 1024) {
      setMobileSheetOpen(true);
    }
  };

  const FeedbackFormContent = () => (
    <div className="space-y-6">
      {/* Rating */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Overall Rating</label>
          <span
            className="rc-mono text-[12px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}
          >
            {rating[0]}/10
          </span>
        </div>
        <Slider value={rating} onValueChange={setRating} max={10} min={1} step={1} />
      </div>

      {/* Effort */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Effort Level (RPE)</label>
          <span
            className="rc-mono text-[12px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}
          >
            {effort[0]}/10
          </span>
        </div>
        <Slider value={effort} onValueChange={setEffort} max={10} min={1} step={1} />
      </div>

      {/* Feeling — pill buttons */}
      <div className="space-y-3">
        <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>How did you feel?</label>
        <div className="flex flex-wrap gap-2">
          {feelingOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setFeeling(opt.toLowerCase())}
              className="rc-mono px-3.5 py-[7px] rounded-full text-[11px] font-medium transition-colors"
              style={{
                background: feeling === opt.toLowerCase() ? 'var(--rc-ink)' : 'var(--rc-surface-2)',
                color: feeling === opt.toLowerCase() ? '#fff' : 'var(--rc-ink-3)',
                border: `1px solid ${feeling === opt.toLowerCase() ? 'var(--rc-ink)' : 'var(--rc-line)'}`,
                letterSpacing: '0.06em',
              }}
            >
              {opt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Comment */}
      <div className="space-y-3">
        <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Notes (optional)</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Any notes about the run..."
          rows={3}
          className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
          style={{
            background: 'var(--rc-surface-2)',
            border: '1px solid var(--rc-line)',
            color: 'var(--rc-ink)',
          }}
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!selectedRun || submitting}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: 'var(--rc-blue)', color: '#fff' }}
      >
        {submitted ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {submitting ? 'Saving...' : submitted ? 'Saved!' : 'Save Feedback'}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <Skeleton className="h-10 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="rc-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
          LOG RUNS
        </div>
        <h1
          className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
          style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
        >
          Run feedback,{' '}
          <span
            className="font-normal italic"
            style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--rc-ink-2)' }}
          >
            post-run.
          </span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--rc-ink-3)' }}>
          Record your post-run feedback and ratings.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Run Selector */}
        <div className="rc-card p-0 overflow-hidden lg:row-span-2">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
            <div>
              <div className="rc-kicker mb-1">Select a run</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Recent runs</h3>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
              <ClipboardList className="w-4 h-4" />
            </div>
          </div>
          {runs.length > 0 ? (
            <div className="overflow-y-auto" style={{ maxHeight: '500px' }}>
              {runs.map((run, idx) => (
                <div
                  key={run.id}
                  onClick={() => handleRunSelect(run.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleRunSelect(run.id)}
                  className="grid items-center gap-4 px-6 py-4 transition-colors cursor-pointer"
                  style={{
                    gridTemplateColumns: '36px 1fr auto',
                    borderBottom: '1px solid var(--rc-line)',
                    background: selectedRun === run.id ? 'var(--rc-blue-soft)' : 'transparent',
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-[10px] grid place-items-center"
                    style={{
                      background: selectedRun === run.id ? 'var(--rc-blue)' : 'oklch(0.96 0.04 240)',
                      color: selectedRun === run.id ? '#fff' : 'var(--rc-blue-deep)',
                    }}
                  >
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[14.5px] font-semibold" style={{ letterSpacing: '-0.005em', color: 'var(--rc-ink)' }}>
                      {run.workout_name || 'Run'}
                    </div>
                    <div className="rc-mono text-[11px] uppercase mt-0.5" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>
                      {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} · {new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="rc-mono font-semibold text-[16px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}>
                      {run.distance_km.toFixed(1)}<span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--rc-ink-3)' }}>km</span>
                    </div>
                    <div className="rc-mono text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>{run.avg_pace_str || '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--rc-ink-3)' }}>
              <ClipboardList className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
              <p className="text-sm font-medium">No runs available to log</p>
              <p className="text-xs mt-1">Sync from Strava to see your recent runs.</p>
            </div>
          )}
        </div>

        {/* Feedback Form — Desktop */}
        <div className="rc-card p-0 overflow-hidden hidden lg:block">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
            <div>
              <div className="rc-kicker mb-1">Feedback</div>
              <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>How did it feel?</h3>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-good-soft)', color: 'oklch(0.42 0.10 150)' }}>
              <Save className="w-4 h-4" />
            </div>
          </div>
          <div className="p-6">
            <FeedbackFormContent />
          </div>
        </div>
      </div>

      {/* Mobile Feedback Sheet */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2">
                <div className="p-2 rounded-xl" style={{ background: 'var(--rc-good-soft)', color: 'oklch(0.42 0.10 150)' }}>
                  <Save className="w-4 h-4" />
                </div>
                <span style={{ color: 'var(--rc-ink)' }}>Run Feedback</span>
              </SheetTitle>
            </div>
            {selectedRun && (
              <p className="text-sm" style={{ color: 'var(--rc-ink-3)' }}>
                {runs.find(r => r.id === selectedRun)?.workout_name || 'Run'} - {' '}
                {runs.find(r => r.id === selectedRun)?.distance_km?.toFixed(1)} km
              </p>
            )}
          </SheetHeader>
          <div className="pb-8">
            <FeedbackFormContent />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
