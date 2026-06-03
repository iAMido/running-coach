'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ClipboardList, CheckCircle, Save, Activity } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Run } from '@/lib/db/types';

const feelingOptions = ['Great', 'Good', 'Okay', 'Tired', 'Exhausted'];

interface FeedbackFormProps {
  rating: number[];
  setRating: (v: number[]) => void;
  effort: number[];
  setEffort: (v: number[]) => void;
  feeling: string;
  setFeeling: (v: string) => void;
  preRunFeeling: string;
  setPreRunFeeling: (v: string) => void;
  followedPlan: string;
  setFollowedPlan: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  selectedRun: string;
  submitting: boolean;
  submitted: boolean;
  onSubmit: () => void;
}

function FeedbackFormContent({
  rating, setRating, effort, setEffort, feeling, setFeeling,
  preRunFeeling, setPreRunFeeling, followedPlan, setFollowedPlan,
  comment, setComment, selectedRun, submitting, submitted, onSubmit,
}: FeedbackFormProps) {
  return (
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
          {feelingOptions.map((opt) => {
            const isSelected = feeling === opt.toLowerCase();
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setFeeling(opt.toLowerCase())}
                className="rc-mono px-3.5 py-[7px] rounded-full text-[11px] font-medium transition-colors"
                // Inline hex colors instead of var(--rc-ink) so iOS Safari
                // can't lose the selected pill's contrast through Radix
                // portals. -WebkitTextFillColor forces the white text even
                // if a parent sets a different color-scheme.
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: isSelected ? '#0E0F0C' : '#FBFAF6',
                  color: isSelected ? '#FFFFFF' : '#6B6C66',
                  WebkitTextFillColor: isSelected ? '#FFFFFF' : '#6B6C66',
                  border: `1px solid ${isSelected ? '#0E0F0C' : 'rgba(14,15,12,0.08)'}`,
                  letterSpacing: '0.06em',
                }}
              >
                {opt.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pre-run feeling */}
      <div className="space-y-3">
        <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Before the run, you felt…</label>
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'fresh', label: 'Fresh' },
            { value: 'good', label: 'Good' },
            { value: 'tired', label: 'Tired' },
            { value: 'sore_legs', label: 'Sore legs' },
            { value: 'stressed', label: 'Stressed' },
          ] as const).map(({ value, label }) => {
            const isSelected = preRunFeeling === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setPreRunFeeling(preRunFeeling === value ? '' : value)}
                className="rc-mono px-3.5 py-[7px] rounded-full text-[11px] font-medium transition-colors"
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: isSelected ? '#0E0F0C' : '#FBFAF6',
                  color: isSelected ? '#FFFFFF' : '#6B6C66',
                  WebkitTextFillColor: isSelected ? '#FFFFFF' : '#6B6C66',
                  border: `1px solid ${isSelected ? '#0E0F0C' : 'rgba(14,15,12,0.08)'}`,
                  letterSpacing: '0.06em',
                }}
              >
                {label.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Followed plan */}
      <div className="space-y-3">
        <label className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Did you follow the plan?</label>
        <div className="flex gap-2">
          {([
            { value: 'yes', label: 'Yes' },
            { value: 'modified', label: 'Modified it' },
            { value: 'no', label: 'No' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFollowedPlan(followedPlan === value ? '' : value)}
              className="flex-1 rc-mono py-[9px] rounded-xl text-[11px] font-medium transition-colors"
              style={{
                background: followedPlan === value
                  ? value === 'yes' ? 'oklch(0.96 0.08 150)' : value === 'no' ? 'oklch(0.95 0.05 25)' : 'oklch(0.96 0.05 75)'
                  : 'var(--rc-surface-2)',
                color: followedPlan === value
                  ? value === 'yes' ? '#059669' : value === 'no' ? 'var(--rc-bad)' : 'oklch(0.50 0.13 75)'
                  : 'var(--rc-ink-3)',
                border: `1px solid ${followedPlan === value ? 'transparent' : 'var(--rc-line)'}`,
                letterSpacing: '0.06em',
              }}
            >
              {label.toUpperCase()}
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

      {/* Submit — sticky at the bottom so it's always reachable on mobile
          (iOS Safari was hiding it under the on-screen keyboard / safe area
          when the Notes textarea was focused). */}
      <div
        className="sticky bottom-0 left-0 right-0 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] -mx-1 px-1"
        style={{
          background: 'linear-gradient(to top, var(--rc-surface) 75%, transparent)',
        }}
      >
        <button
          onClick={onSubmit}
          disabled={!selectedRun || submitting}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
          style={{
            WebkitAppearance: 'none',
            appearance: 'none',
            background: '#2563EB',
            color: '#FFFFFF',
            WebkitTextFillColor: '#FFFFFF',
          }}
        >
          {submitted ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {submitting ? 'Saving...' : submitted ? 'Saved!' : 'Save Feedback'}
        </button>
      </div>
    </div>
  );
}

export default function LogRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState([5]);
  const [effort, setEffort] = useState([5]);
  const [feeling, setFeeling] = useState('');
  const [preRunFeeling, setPreRunFeeling] = useState('');
  const [followedPlan, setFollowedPlan] = useState('');
  const [comment, setComment] = useState('');
  const [selectedRun, setSelectedRun] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [loggedRunIds, setLoggedRunIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchRuns();
    fetchLoggedRuns();
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

  const fetchLoggedRuns = async () => {
    try {
      const response = await fetch('/api/coach/feedback?days=60');
      const data = await response.json();
      const ids = new Set<string>(
        (data.feedback || [])
          .filter((f: { run_id: string | null }) => f.run_id)
          .map((f: { run_id: string }) => f.run_id)
      );
      setLoggedRunIds(ids);
    } catch (error) {
      console.error('Failed to fetch feedback:', error);
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
          run_id: runData.id,
          run_date: runData.date.split('T')[0],
          rating: rating[0],
          effort_level: effort[0],
          feeling,
          comment,
          followed_plan: followedPlan || undefined,
          pre_run_feeling: preRunFeeling || undefined,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        setRating([5]);
        setEffort([5]);
        setFeeling('');
        setPreRunFeeling('');
        setFollowedPlan('');
        setComment('');
        setMobileSheetOpen(false);
        setLoggedRunIds(prev => new Set([...prev, runData.id]));
        setSelectedRun('');
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const isLogged = (run: Run) => loggedRunIds.has(run.id);

  const handleRunSelect = (runId: string) => {
    setSelectedRun(runId);
    if (window.innerWidth < 1024) {
      setMobileSheetOpen(true);
    }
  };

  const formProps: FeedbackFormProps = {
    rating, setRating, effort, setEffort, feeling, setFeeling,
    preRunFeeling, setPreRunFeeling, followedPlan, setFollowedPlan,
    comment, setComment, selectedRun, submitting, submitted,
    onSubmit: handleSubmit,
  };

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
              {runs.map((run) => {
                const logged = isLogged(run);
                const isSelected = selectedRun === run.id;
                return (
                  <div
                    key={run.id}
                    onClick={() => handleRunSelect(run.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleRunSelect(run.id)}
                    className="relative grid items-center gap-4 px-6 py-4 transition-colors cursor-pointer overflow-hidden"
                    style={{
                      gridTemplateColumns: '36px 1fr auto',
                      borderBottom: '1px solid var(--rc-line)',
                      background: isSelected ? 'var(--rc-blue-soft)' : 'transparent',
                    }}
                  >
                    {/* Logged ribbon */}
                    {logged && (
                      <span
                        className="absolute left-0 top-0 bottom-0 w-[3px]"
                        style={{ background: 'var(--rc-good, #10B981)' }}
                      />
                    )}
                    <div
                      className="w-9 h-9 rounded-[10px] grid place-items-center"
                      style={{
                        background: isSelected ? 'var(--rc-blue)' : logged ? 'oklch(0.96 0.08 150)' : 'oklch(0.96 0.04 240)',
                        color: isSelected ? '#fff' : logged ? '#059669' : 'var(--rc-blue-deep)',
                      }}
                    >
                      {logged ? <CheckCircle className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-semibold" style={{ letterSpacing: '-0.005em', color: 'var(--rc-ink)' }}>
                          {run.workout_name || 'Run'}
                        </span>
                        {logged && (
                          <span className="rc-mono text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'oklch(0.96 0.08 150)', color: '#059669', letterSpacing: '0.06em' }}>
                            LOGGED
                          </span>
                        )}
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
                );
              })}
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
            <FeedbackFormContent {...formProps} />
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
            <FeedbackFormContent {...formProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
