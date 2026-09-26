'use client';

/**
 * "How this plan was built" — the staged builder's reasoning and checks,
 * saved with the plan (plan_json.build_report). Plans from the single-call
 * generator have no report and render nothing.
 */

import type { BuildReport } from '@/lib/coach/plan-builder/types';

/** `unit` names what issue numbers refer to: weeks for a training block, phases for a season. */
export function PlanBuildReport({ report, unit = 'Week' }: { report: BuildReport; unit?: 'Week' | 'Phase' }) {
  const c = report.checks;
  const r = report.coherence;
  const muted = { color: 'var(--rc-ink-3)' };
  return (
    <details className="rc-card p-5 group">
      <summary className="cursor-pointer list-none flex items-center justify-between">
        <span className="rc-kicker">{unit === 'Phase' ? 'HOW THIS SEASON WAS BUILT' : 'HOW THIS PLAN WAS BUILT'}</span>
        <span className="rc-mono text-[11px]" style={muted}>
          {c.errors === 0 ? 'all rules pass' : `${c.errors} rule issue(s)`} · {r.rounds} review round{r.rounds === 1 ? '' : 's'} · {report.seconds}s
        </span>
      </summary>

      <div className="mt-4 space-y-4 text-[13px]" style={{ color: 'var(--rc-ink-2)' }}>
        {report.rationale && (
          <section>
            <h4 className="font-semibold mb-1">Strategy</h4>
            <p>{report.rationale}</p>
          </section>
        )}

        {report.phases.length > 0 && (
          <section>
            <h4 className="font-semibold mb-1">Phases</h4>
            <ul className="space-y-1">
              {report.phases.map((p) => (
                <li key={p.name}>
                  <span className="font-medium">{p.name}</span> <span style={muted}>(weeks {p.start_week}-{p.end_week})</span> — {p.purpose}
                  {p.exit_criteria.length > 0 && <div className="text-[12px]" style={muted}>Exit: {p.exit_criteria.join('; ')}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.decisions.length > 0 && (
          <section>
            <h4 className="font-semibold mb-1">Decisions</h4>
            <ul className="list-disc pl-5 space-y-0.5">{report.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>
        )}

        {report.athlete_notes.length > 0 && (
          <section>
            <h4 className="font-semibold mb-1">Worth knowing</h4>
            <ul className="list-disc pl-5 space-y-0.5" style={{ color: 'oklch(0.50 0.13 75)' }}>
              {report.athlete_notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </section>
        )}

        <section>
          <h4 className="font-semibold mb-1">Checks</h4>
          <p style={muted}>
            {c.errors === 0 ? 'Every rule passes' : `${c.errors} rule problem(s) remain`} ({c.warnings} note{c.warnings === 1 ? '' : 's'}).
            {c.repaired_weeks.length > 0 && ` ${unit}s ${c.repaired_weeks.join(', ')} were rewritten to fix rule breaks.`}
          </p>
          {c.remaining.filter((v) => v.severity === 'error').map((v, i) => (
            <div key={i} className="text-[12px]" style={{ color: 'oklch(0.50 0.18 25)' }}>{v.week ? `${unit} ${v.week}${v.day ? ` ${v.day}` : ''}: ` : ''}{v.message}</div>
          ))}
        </section>

        <section>
          <h4 className="font-semibold mb-1">Does it all fit?</h4>
          {r.summary && <p>{r.summary}</p>}
          {r.addressed.length > 0 && (
            <div className="mt-1">
              <div className="text-[12px] font-medium" style={muted}>Found and rewritten:</div>
              <ul className="list-disc pl-5 text-[12px] space-y-0.5" style={muted}>
                {r.addressed.map((i, k) => <li key={k}>{i.weeks.length ? `${unit}s ${i.weeks.join(', ')}: ` : ''}{i.problem}</li>)}
              </ul>
            </div>
          )}
          {r.open.length > 0 && (
            <div className="mt-1">
              <div className="text-[12px] font-medium" style={muted}>Coach&apos;s notes:</div>
              <ul className="list-disc pl-5 text-[12px] space-y-0.5" style={muted}>
                {r.open.map((i, k) => <li key={k}>{i.weeks.length ? `${unit}s ${i.weeks.join(', ')}: ` : ''}{i.problem}{i.fix ? ` — ${i.fix}` : ''}</li>)}
              </ul>
            </div>
          )}
        </section>

        <p className="rc-mono text-[10.5px]" style={{ color: 'var(--rc-ink-4)' }}>
          Design & review: {report.models.outline}{report.models.writer !== '—' ? ` · Phases: ${report.models.writer}` : ''}
        </p>
      </div>
    </details>
  );
}
