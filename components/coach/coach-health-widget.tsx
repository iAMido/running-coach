'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, TrendingUp, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface HealthData {
  totalCalls: number;
  errors: number;
  ceilingHits: number;
  avgLatencyMs: number;
  preflightWarnings: number;
  topWarnings: { code: string; count: number }[];
  criticCount: number;
  criticAvgOverall: number | null;
}

/**
 * Lives on the coach dashboard. Pulls /api/coach/health which aggregates
 * the last 7 days of supervisor telemetry — average critic score, top
 * preflight warning codes, ceiling-hit count. Gracefully hides itself
 * when there's no data yet.
 */
export function CoachHealthWidget() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/coach/health')
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  if (data.totalCalls === 0) return null;

  const scoreOk = data.criticAvgOverall == null || data.criticAvgOverall >= 3.5;
  const hasWarnings = data.preflightWarnings > 0;

  return (
    <div className="rc-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {scoreOk && !hasWarnings ? (
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--rc-good)' }} />
          ) : (
            <ShieldAlert className="w-4 h-4" style={{ color: 'oklch(0.55 0.15 75)' }} />
          )}
          <div className="rc-kicker">Coach Health · last 7d</div>
        </div>
        <Link
          href="/coach/reports"
          className="rc-mono text-[10.5px] flex items-center gap-1"
          style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}
        >
          REPORTS <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Calls"
          value={data.totalCalls.toString()}
          sub={data.errors > 0 ? `${data.errors} errors` : 'all ok'}
          subAccent={data.errors > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Avg critic"
          value={data.criticAvgOverall != null ? `${data.criticAvgOverall.toFixed(1)}` : '—'}
          unit={data.criticAvgOverall != null ? '/5' : ''}
          sub={data.criticCount > 0 ? `n=${data.criticCount}` : 'no audits'}
          subAccent={scoreOk ? 'good' : 'bad'}
        />
        <Stat
          label="Warnings"
          value={data.preflightWarnings.toString()}
          sub={hasWarnings ? 'see codes →' : 'none'}
          subAccent={hasWarnings ? 'warn' : 'good'}
        />
        <Stat
          label="Ceiling hits"
          value={data.ceilingHits.toString()}
          sub={`avg ${data.avgLatencyMs}ms`}
          subAccent="neutral"
          icon={TrendingUp}
        />
      </div>

      {data.topWarnings.length > 0 && (
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--rc-line)' }}>
          <div className="rc-kicker mb-2">Top warning codes</div>
          <div className="flex flex-wrap gap-1.5">
            {data.topWarnings.map(w => (
              <span
                key={w.code}
                className="rc-mono text-[10.5px] px-2 py-1 rounded-md"
                style={{
                  background: 'oklch(0.96 0.05 75)',
                  color: 'oklch(0.40 0.10 75)',
                  border: '1px solid oklch(0.90 0.06 75)',
                }}
              >
                {w.code} <span style={{ opacity: 0.65 }}>×{w.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subAccent?: 'good' | 'bad' | 'warn' | 'neutral';
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

function Stat({ label, value, unit, sub, subAccent, icon: Icon }: StatProps) {
  const subColor =
    subAccent === 'good'
      ? 'var(--rc-good)'
      : subAccent === 'bad'
      ? 'var(--rc-bad)'
      : subAccent === 'warn'
      ? 'oklch(0.55 0.15 75)'
      : 'var(--rc-ink-4)';
  return (
    <div>
      <div className="rc-kicker mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div
        className="text-[22px] font-bold leading-none"
        style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--rc-ink)' }}
      >
        {value}
        {unit && <span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--rc-ink-3)' }}>{unit}</span>}
      </div>
      {sub && (
        <div className="text-[10.5px] mt-1 rc-mono" style={{ color: subColor, letterSpacing: '0.05em' }}>
          {sub}
        </div>
      )}
    </div>
  );
}
