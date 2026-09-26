'use client';

/**
 * The current season phase: its KPIs measured against the athlete's data, and
 * what to do about it (lib/coach/season-progress.ts `recommend`). A phase is
 * due in its last 2 weeks or when every KPI is met; the athlete decides —
 * nothing advances until he builds the next phase.
 */

import { ArrowRight, CheckCircle2, Clock, TrendingDown, TrendingUp, Minus } from 'lucide-react';

export interface SeasonStatusView {
  macroPlanId: string;
  current: { phaseNumber: number; name: string; weekOfPhase: number | null; weeks: number; weeksLeft: number | null; built: boolean } | null;
  kpis: { label: string; target: number; comparator: 'gte' | 'lte'; current: number | null; met: boolean; trend: 'up' | 'down' | 'flat' | null; detail: string }[];
  recommendation:
    | { kind: 'not_started' | 'on_track' | 'build_next' | 'season_end'; message: string }
    | { kind: 'advance_with_gap'; message: string; gaps: string[] }
    | { kind: 'extend'; message: string; weeks: 2 | 3; eatsTaper: boolean }
    | null;
  raceSlackWeeks: number | null;
  timeline: { phaseNumber: number; start: string; end: string; weeks: number; status: 'planned' | 'active' | 'done'; projected: boolean; extensionWeeks: number }[];
}

export function SeasonPhaseStatus({
  status, busy, phaseCount, onBuild,
}: {
  status: SeasonStatusView;
  busy: boolean;
  phaseCount: number;
  /** Build a phase (or extend the current one by `extensionWeeks`). */
  onBuild: (phaseNumber: number, extensionWeeks?: number) => void;
}) {
  const c = status.current;
  const r = status.recommendation;
  if (!c || !r) return null;
  const next = c.phaseNumber < phaseCount ? c.phaseNumber + 1 : null;
  const muted = { color: 'var(--rc-ink-3)' };
  const tone = r.kind === 'extend' ? 'oklch(0.55 0.13 60)' : r.kind === 'on_track' ? 'var(--rc-ink-3)' : 'oklch(0.50 0.13 150)';

  return (
    <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="rc-kicker">Current phase</div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--rc-ink)' }}>
            {c.phaseNumber}. {c.name}
            {c.weekOfPhase !== null && (
              <span className="rc-mono font-normal text-[11px] ml-2" style={muted}>week {c.weekOfPhase} of {c.weeks}</span>
            )}
          </div>
        </div>
        {status.raceSlackWeeks !== null && (
          <span className="rc-mono text-[11px]" style={{ color: status.raceSlackWeeks < 0 ? 'oklch(0.5 0.18 25)' : 'var(--rc-ink-4)' }}>
            {status.raceSlackWeeks < 0 ? `${-status.raceSlackWeeks} wk past race day` : `${status.raceSlackWeeks} wk slack to race`}
          </span>
        )}
      </div>

      {status.kpis.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="rc-mono text-[10px] uppercase" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}>
              <th className="text-left font-medium pb-1">KPI</th>
              <th className="text-right font-medium pb-1">Target</th>
              <th className="text-right font-medium pb-1">Now</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {status.kpis.map((k) => (
              <tr key={k.label} title={k.detail} style={{ borderTop: '1px solid var(--rc-line)' }}>
                <td className="py-1.5 pr-2" style={{ color: 'var(--rc-ink-2)' }}>{k.label}</td>
                <td className="py-1.5 text-right rc-mono" style={muted}>{k.comparator === 'gte' ? '≥' : '≤'} {k.target}</td>
                <td className="py-1.5 text-right rc-mono" style={{ color: 'var(--rc-ink)' }}>{k.current ?? '—'}</td>
                <td className="py-1.5 pl-2 w-6">
                  {k.current === null ? <Minus className="w-3.5 h-3.5" style={{ color: 'var(--rc-ink-4)' }} />
                    : k.met ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'oklch(0.55 0.13 150)' }} />
                    : k.trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" style={{ color: 'oklch(0.55 0.13 60)' }} />
                    : k.trend === 'down' ? <TrendingDown className="w-3.5 h-3.5" style={{ color: 'oklch(0.5 0.18 25)' }} />
                    : <Clock className="w-3.5 h-3.5" style={{ color: 'oklch(0.55 0.13 60)' }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-[12.5px]" style={{ color: tone }}>{r.message}</p>

      <div className="flex flex-wrap gap-2">
        {r.kind === 'not_started' && (
          <ActionButton disabled={busy} onClick={() => onBuild(c.phaseNumber)} label={`Build phase ${c.phaseNumber}`} primary />
        )}
        {(r.kind === 'build_next' || r.kind === 'advance_with_gap') && next && (
          <ActionButton disabled={busy} onClick={() => onBuild(next)} label={`Build phase ${next}`} primary />
        )}
        {r.kind === 'extend' && (
          <>
            <ActionButton disabled={busy} onClick={() => onBuild(c.phaseNumber, r.weeks)} label={`Extend ${r.weeks} weeks`} primary />
            {next && <ActionButton disabled={busy} onClick={() => onBuild(next)} label={`Advance to phase ${next} anyway`} />}
          </>
        )}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-medium disabled:opacity-40"
      style={primary
        ? { background: 'var(--rc-blue)', color: 'white' }
        : { background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}
    >
      {label} <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );
}
