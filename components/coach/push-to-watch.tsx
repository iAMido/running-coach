'use client';

/**
 * Send one plan week to the athlete's intervals.icu calendar, which syncs it to
 * the watch.
 *
 * Three things this panel exists to make visible, all of them decided before it
 * was built:
 *
 * 1. PREVIEW FIRST. The resolved bpm sits beside every percentage because bpm is
 *    the number the athlete recognises — a mapping error is obvious as
 *    "120-135" and invisible as "62.9-70.6%". Percentages are what actually get
 *    stored; bpm is shown so the translation can be checked.
 * 2. PUSH MEANS REPLACE. It deletes this app's own previous events for the week
 *    before writing. That is destructive, so the count of what will be removed
 *    is shown before the confirm button, not after.
 * 3. THE 7-DAY HORIZON IS A DELAY, NOT A FAILURE. intervals.icu only syncs about
 *    a week ahead to the device. A further-out session lands on the calendar and
 *    reaches the watch later, so those rows are marked as waiting rather than
 *    failed — and marked visually, since a payload flag nobody can see would let
 *    the athlete assume everything synced.
 */

import { useEffect, useState } from 'react';
import { Watch, AlertTriangle, Check, Loader2, Clock } from 'lucide-react';

interface PushRow {
  day: string;
  date: string;
  workoutName: string;
  description: string | null;
  minutes: number | null;
  bpmLow: number | null;
  bpmHigh: number | null;
  pctLabel: string | null;
  notes: string[];
  skipReason?: string;
  beyondWatchHorizon: boolean;
}

interface PreviewResponse {
  weekNumber: number;
  maxHr: number;
  theirMaxHr: number | null;
  horizonDays: number;
  /** Null means the calendar could not be read — not that it is empty. */
  existingAppEvents: number | null;
  rows: PushRow[];
}

interface PushResponse {
  created: number;
  replaced: number;
  skipped: number;
  beyondHorizon: number;
  errors: string[];
}

/** 'YYYY-MM-DD' as a local date — never `new Date(str)`, which parses as UTC. */
function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PushToWatch({
  weekNumber,
  currentWeek,
}: {
  weekNumber: number;
  currentWeek: number;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/intervals/connect')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConnected(Boolean(d?.connected)))
      .catch(() => setConnected(false));
  }, []);

  // Navigating to a different week invalidates everything on screen: a preview
  // of week 9 must never sit above a Push button that would send week 10.
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setError(null);
  }, [weekNumber]);

  const inRange = weekNumber >= currentWeek && weekNumber <= currentWeek + 1;

  const call = async (isPreview: boolean) => {
    const setBusy = isPreview ? setLoading : setPushing;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/intervals/push-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekNumber, preview: isPreview }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      if (isPreview) {
        setPreview(data as PreviewResponse);
        setResult(null);
      } else {
        setResult(data as PushResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (connected === null || connected === false) return null;

  const writable = preview?.rows.filter((r) => r.description) ?? [];
  const waiting = writable.filter((r) => r.beyondWatchHorizon).length;
  const maxHrClash =
    preview?.theirMaxHr != null && preview.theirMaxHr !== preview.maxHr ? preview.theirMaxHr : null;

  return (
    <div className="rc-card p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="rc-kicker flex items-center gap-2" style={{ color: 'var(--rc-ink-3)' }}>
            <Watch className="w-3.5 h-3.5" />
            SEND TO WATCH
          </div>
          <p className="text-sm mt-2" style={{ color: 'var(--rc-ink-2)' }}>
            {inRange
              ? 'Put this week on your intervals.icu calendar as structured workouts.'
              : `Only week ${currentWeek} and week ${currentWeek + 1} can be sent — anything further out wouldn't reach the watch yet.`}
          </p>
        </div>
        {inRange && (
          <button
            onClick={() => call(true)}
            disabled={loading || pushing}
            className="rc-mono text-[11px] font-medium px-4 py-2 rounded-full transition-colors disabled:opacity-40"
            style={{
              background: 'var(--rc-surface-2)',
              border: '1px solid var(--rc-line)',
              color: 'var(--rc-ink-2)',
              letterSpacing: '0.06em',
            }}
          >
            {loading ? 'CHECKING…' : preview ? 'REFRESH PREVIEW' : 'PREVIEW'}
          </button>
        )}
      </div>

      {error && (
        <div
          className="mt-4 text-sm p-3 rounded-xl"
          style={{ background: 'oklch(0.96 0.04 25)', color: 'oklch(0.45 0.15 25)' }}
        >
          {error}
        </div>
      )}

      {preview && (
        <div className="mt-5 space-y-4">
          {/* Percentages resolve against THEIR max HR. If the two numbers
              disagree every target lands somewhere else, so say it here rather
              than let the push return a 409 the athlete has to decode. */}
          {maxHrClash !== null && (
            <div
              className="flex gap-2.5 text-sm p-3.5 rounded-xl"
              style={{ background: 'oklch(0.96 0.04 25)', color: 'oklch(0.45 0.15 25)' }}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                intervals.icu has your max HR as <strong>{maxHrClash}</strong>, this app has{' '}
                <strong>{preview.maxHr}</strong>. Targets are stored as percentages and resolved
                against their number, so every session would land on a different heart-rate range
                than the plan intends. Sending is blocked until the two agree.
              </span>
            </div>
          )}

          <div className="space-y-2">
            {preview.rows.map((row) => (
              <div
                key={row.date + row.workoutName}
                className="flex items-center justify-between gap-4 flex-wrap px-4 py-3 rounded-xl"
                style={{
                  background: row.beyondWatchHorizon ? 'oklch(0.97 0.03 75)' : 'var(--rc-surface-2)',
                  border: row.beyondWatchHorizon
                    ? '1px dashed oklch(0.80 0.09 75)'
                    : '1px solid var(--rc-line)',
                  opacity: row.description ? 1 : 0.55,
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>
                    {row.day} <span style={{ color: 'var(--rc-ink-3)' }}>· {formatDay(row.date)}</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--rc-ink-2)' }}>
                    {row.workoutName}
                    {row.skipReason && (
                      <span style={{ color: 'var(--rc-ink-3)' }}> — {row.skipReason}, so it won&apos;t be sent</span>
                    )}
                  </div>
                  {row.notes.map((note, i) => (
                    <div key={i} className="text-xs mt-1" style={{ color: 'var(--rc-ink-3)' }}>
                      {note}
                    </div>
                  ))}
                </div>

                <div className="text-right shrink-0">
                  {row.description ? (
                    <>
                      <div className="rc-mono text-[12px]" style={{ color: 'var(--rc-ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {row.minutes} min · {row.bpmLow}–{row.bpmHigh} bpm
                      </div>
                      <div className="rc-mono text-[10.5px] mt-0.5" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.04em' }}>
                        sent as {row.pctLabel}
                      </div>
                      {row.beyondWatchHorizon && (
                        <div
                          className="rc-mono text-[10px] mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: 'oklch(0.93 0.07 75)', color: 'oklch(0.44 0.11 75)', letterSpacing: '0.06em' }}
                        >
                          <Clock className="w-3 h-3" />
                          REACHES YOUR WATCH CLOSER TO THE DATE
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rc-mono text-[10.5px]" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>
                      SKIPPED
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* What the confirm actually does. "Replace" is the right semantic but
              it deletes, so the number is stated before the button. */}
          <div className="text-xs leading-relaxed" style={{ color: 'var(--rc-ink-3)' }}>
            {preview.existingAppEvents === null ? (
              <>
                Couldn&apos;t read your intervals.icu calendar to count sessions this app already
                sent for this week. Sending will refuse rather than risk creating duplicates.
              </>
            ) : preview.existingAppEvents === 0 ? (
              <>
                Nothing has been sent for this week yet, so this writes{' '}
                <strong>{writable.length}</strong> new session
                {writable.length === 1 ? '' : 's'}. Sending again later replaces them rather than
                adding duplicates.
              </>
            ) : (
              <>
                Sending <strong>replaces</strong> this week: it removes the{' '}
                <strong>{preview.existingAppEvents}</strong> session
                {preview.existingAppEvents === 1 ? '' : 's'} this app previously sent for these dates
                and writes <strong>{writable.length}</strong> fresh. Workouts you created yourself in
                intervals.icu are never touched.
              </>
            )}
            {waiting > 0 && (
              <>
                {' '}
                {waiting} of them {waiting === 1 ? 'sits' : 'sit'} beyond the {preview.horizonDays}
                -day sync window — {waiting === 1 ? 'it lands' : 'they land'} on the calendar now and
                appear on the watch closer to the date.
              </>
            )}
          </div>

          <button
            onClick={() => call(false)}
            disabled={pushing || writable.length === 0 || maxHrClash !== null}
            className="rc-mono text-[11px] font-medium px-5 py-2.5 rounded-full inline-flex items-center gap-2 transition-colors disabled:opacity-40"
            style={{ background: 'var(--rc-ink)', color: '#fff', letterSpacing: '0.06em' }}
          >
            {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Watch className="w-3.5 h-3.5" />}
            {pushing ? 'SENDING…' : `SEND ${writable.length} SESSION${writable.length === 1 ? '' : 'S'}`}
          </button>
        </div>
      )}

      {result && (
        <div
          className="mt-4 text-sm p-3.5 rounded-xl flex gap-2.5"
          style={{ background: 'oklch(0.96 0.04 150)', color: 'oklch(0.38 0.10 150)' }}
        >
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Sent {result.created} session{result.created === 1 ? '' : 's'}
            {result.replaced > 0 && `, replacing ${result.replaced} previously sent`}.
            {result.beyondHorizon > 0 &&
              ` ${result.beyondHorizon} will appear on your watch closer to the date.`}
            {result.errors.length > 0 && (
              <span style={{ display: 'block', marginTop: 6, color: 'oklch(0.45 0.15 25)' }}>
                {result.errors.join(' · ')}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
