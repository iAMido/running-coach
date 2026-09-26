'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, TrendingUp } from 'lucide-react';

interface HealthData {
  totalCalls: number;
  errors: number;
  ceilingHits: number;
  avgLatencyMs: number;
  planBuildCalls?: number;
  preflightWarnings: number;
  topWarnings: { code: string; count: number }[];
  criticCount: number;
  criticAvgOverall: number | null;
}

/**
 * Plain-language meaning of each pre-flight warning code (lib/supervisor/
 * preflight.ts). A warning is the supervisor noting that the coach answered
 * with something missing from its context — not an error in the app.
 */
const WARNING_MEANING: Record<string, string> = {
  no_planned_today: 'You asked the coach something on a day with no planned workout — usually no active plan, or a rest day.',
  no_book_sources: "The book search found nothing for the question. Normal for short follow-ups (\"2. Don't know\"); a problem only on real training questions.",
  no_planned_week: 'A weekly review ran with no active plan covering that week, so planned-vs-actual was limited.',
  review_no_runs: 'A weekly review ran for a week with no runs logged.',
  no_recent_runs: 'No runs in the last 14 days reached the coach.',
  no_coach_workouts: "Your previous coach's familiar sessions were not found for a plan.",
  no_wellness_data: 'No recovery data (HRV, sleep, resting HR) has been synced.',
  stale_wellness_data: 'The newest recovery data is several days old.',
  user_context_too_small: 'Very little of your profile or recent activity reached the coach.',
  no_active_plan_for_modification: 'A plan change was requested in chat but there is no active plan to change.',
};

/**
 * Lives on the System tab of Coach Reports (moved off the dashboard
 * 2026-09-27 — it describes the app, not the training). Pulls
 * /api/coach/health, which aggregates the last 7 days of supervisor
 * telemetry. Gracefully hides itself when there's no data yet.
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
        <span className="rc-mono text-[10.5px]" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.08em' }}>
          ALL AI CALLS THE APP MADE
        </span>
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
          sub={`chat & reviews avg ${(data.avgLatencyMs / 1000).toFixed(1)} s${data.planBuildCalls ? ` · ${data.planBuildCalls} plan-build calls` : ''}`}
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
          <ul className="mt-3 space-y-1 text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>
            {data.topWarnings.filter((w) => WARNING_MEANING[w.code]).map((w) => (
              <li key={w.code}><span className="rc-mono" style={{ color: 'var(--rc-ink-2)' }}>{w.code}</span> — {WARNING_MEANING[w.code]}</li>
            ))}
          </ul>
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
