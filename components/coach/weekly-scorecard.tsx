'use client';

/**
 * The weekly scorecard.
 *
 * ## The row without a colour is the point of this component
 *
 * Two rows carry green/amber/red. The aerobic-control row carries none, because
 * colouring it would reimport Friel's decoupling bands through the presentation
 * layer after they were deliberately kept out of the data layer.
 *
 * A gap in the middle of a traffic-light column looks like a bug to anyone who
 * did not sit through that decision, and the obvious "fix" is the thing we are
 * preventing. So the row is given a deliberately DIFFERENT visual grammar
 * rather than an absent one: a percentile bar showing where the week sits in
 * the athlete's own distribution, with its own explanation underneath. It
 * should read as a measurement of a different type, not as a missing verdict.
 *
 * `lib/utils/scorecard.test.ts` asserts that row's colour is null, with the
 * rationale in the assertion, so the next person meets the reasoning before
 * they change it.
 */

import { useEffect, useState } from 'react';
import { Check, AlertTriangle, XCircle, BarChart3, Info } from 'lucide-react';

type ScoreColour = 'good' | 'warn' | 'bad';

interface ScorecardRow {
  key: string;
  axis: string;
  value: string;
  detail: string;
  colour: ScoreColour | null;
  colourless?: string;
  percentile?: number;
}

interface Scorecard {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  runCount: number;
  runsWithZones: number;
  rows: ScorecardRow[];
}

const COLOURS: Record<ScoreColour, { dot: string; bg: string; fg: string; Icon: typeof Check }> = {
  good: { dot: 'oklch(0.62 0.14 150)', bg: 'oklch(0.96 0.04 150)', fg: 'oklch(0.38 0.10 150)', Icon: Check },
  warn: { dot: 'oklch(0.75 0.14 75)', bg: 'oklch(0.96 0.05 75)', fg: 'oklch(0.45 0.12 75)', Icon: AlertTriangle },
  bad: { dot: 'oklch(0.60 0.18 25)', bg: 'oklch(0.96 0.04 25)', fg: 'oklch(0.45 0.15 25)', Icon: XCircle },
};

export function WeeklyScorecard() {
  const [card, setCard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/coach/review/scorecard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCard(d?.scorecard ?? null))
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !card) return null;

  return (
    <div className="rc-card p-0 overflow-hidden">
      <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
        <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>
          Scorecard
        </h3>
        {/* Sample size travels with the card: three rows over 2 runs is a
            different object from three rows over 5, and nothing else says so. */}
        <p className="rc-mono text-[10.5px] mt-1.5" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.05em' }}>
          {card.weekLabel.toUpperCase()} · {card.runCount} RUN{card.runCount === 1 ? '' : 'S'} ·{' '}
          {card.runsWithZones} WITH VALID ZONES · {card.weekStart} TO {card.weekEnd}
        </p>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--rc-line)' }}>
        {card.rows.map((row) => (
          <div key={row.key} className="px-6 py-4">
            <div className="flex items-start gap-3">
              {row.colour ? (
                <span
                  className="w-6 h-6 rounded-full grid place-items-center shrink-0 mt-0.5"
                  style={{ background: COLOURS[row.colour].bg, color: COLOURS[row.colour].fg }}
                >
                  {(() => {
                    const { Icon } = COLOURS[row.colour];
                    return <Icon className="w-3.5 h-3.5" />;
                  })()}
                </span>
              ) : (
                // Deliberately not a grey traffic light — that would read as a
                // verdict withheld. A chart glyph says "different kind of row".
                <span
                  className="w-6 h-6 rounded-full grid place-items-center shrink-0 mt-0.5"
                  style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)', border: '1px dashed var(--rc-line)' }}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>
                    {row.axis}
                  </span>
                  <span
                    className="rc-mono text-[11px]"
                    style={{ color: row.colour ? COLOURS[row.colour].fg : 'var(--rc-ink-2)' }}
                  >
                    {row.value}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--rc-ink-3)' }}>
                  {row.detail}
                </p>

                {/* Percentile bar: where this week sits in HIS OWN distribution.
                    This is what replaces a colour — a position, not a grade. */}
                {typeof row.percentile === 'number' && (
                  <div className="mt-2.5">
                    <div className="h-1.5 rounded-full relative" style={{ background: 'var(--rc-surface-2)' }}>
                      <span
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full"
                        style={{
                          left: `calc(${Math.max(0, Math.min(100, row.percentile))}% - 5px)`,
                          background: 'var(--rc-ink-2)',
                          border: '2px solid var(--rc-surface)',
                        }}
                      />
                    </div>
                    <div
                      className="flex justify-between rc-mono text-[9.5px] mt-1"
                      style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}
                    >
                      <span>MOST CONTROLLED</span>
                      <span>YOUR HISTORY</span>
                      <span>LEAST</span>
                    </div>
                  </div>
                )}

                {row.colourless && (
                  <p
                    className="text-[11px] mt-2 flex gap-1.5 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)' }}
                  >
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{row.colourless}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
