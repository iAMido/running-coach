'use client';

/**
 * Live progress of a staged plan build (lib/coach/plan-builder). Each step
 * fills in with what it produced as soon as it finishes — the research found,
 * the outline's strategy, the checks and the head coach's verdict — so the
 * wait shows the plan being reasoned about rather than a spinner.
 */

import { CheckCircle2, Circle, Loader2, AlertTriangle } from 'lucide-react';
import { stepsFor, type PlanBuildView } from '@/lib/coach/plan-builder/view';

export function PlanBuildProgress({ build }: { build: PlanBuildView }) {
  const failed = build.stage === 'failed';
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
      <div className="flex items-center justify-between text-xs rc-mono" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.08em' }}>
        <span>{failed ? 'BUILD FAILED' : build.stage === 'done' ? 'PLAN READY' : 'BUILDING YOUR PLAN'}</span>
        <span>{build.seconds}s</span>
      </div>

      <ol className="space-y-2.5">
        {stepsFor(build.kind).map((step, i) => {
          const state = i < build.stepIndex ? 'done' : i === build.stepIndex && !failed ? 'active' : i === build.stepIndex && failed ? 'failed' : 'pending';
          return (
            <li key={step.stage} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0">
                {state === 'done' && <CheckCircle2 className="w-4 h-4" style={{ color: 'oklch(0.55 0.13 150)' }} />}
                {state === 'active' && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--rc-blue)' }} />}
                {state === 'failed' && <AlertTriangle className="w-4 h-4" style={{ color: 'oklch(0.55 0.18 25)' }} />}
                {state === 'pending' && <Circle className="w-4 h-4" style={{ color: 'var(--rc-ink-4)' }} />}
              </span>
              <div className="min-w-0 flex-1 text-[13px]" style={{ color: state === 'pending' ? 'var(--rc-ink-4)' : 'var(--rc-ink)' }}>
                <div className="font-medium">
                  {step.title}
                  {step.stage === 'checked' && build.reviewRound > 0 && state === 'active' && (
                    <span className="font-normal" style={{ color: 'var(--rc-ink-3)' }}> · round {build.reviewRound + (build.stage === 'coherence_fix' ? 0 : 1)}</span>
                  )}
                </div>
                <StepDetail build={build} stage={step.stage} state={state} />
              </div>
            </li>
          );
        })}
      </ol>

      {build.error && (
        <p className="text-[12px]" style={{ color: failed ? 'oklch(0.50 0.18 25)' : 'var(--rc-ink-3)' }}>
          {build.error}{failed && ' Nothing was saved; your current plan is unchanged.'}
        </p>
      )}
    </div>
  );
}

function StepDetail({ build, stage: rawStage, state }: { build: PlanBuildView; stage: string; state: string }) {
  const muted = { color: 'var(--rc-ink-3)' };
  if (state === 'pending') return null;
  // A season has no phase writers: its checks run on the design ('outlined').
  const stage = build.kind === 'season' && rawStage === 'outlined' ? 'written' : rawStage;
  switch (stage) {
    case 'created':
      if (!build.research) return <p className="text-[12px]" style={muted}>Measuring recent load, climbing and run days; searching the books need by need…</p>;
      return (
        <div className="text-[12px] space-y-0.5" style={muted}>
          {build.research.needs.map((n) => (
            <div key={n.need}>{n.need} — {n.sources.length ? n.sources.join(', ') : 'no match'}</div>
          ))}
          {build.research.references.length > 0 && <div>Reference plans: {build.research.references.join(', ')}</div>}
          {build.athleteNotes.map((n) => <div key={n} style={{ color: 'oklch(0.50 0.13 75)' }}>⚠ {n}</div>)}
        </div>
      );
    case 'prepared':
      if (!build.outline) return <p className="text-[12px]" style={muted}>{build.kind === 'season'
        ? 'Deciding phases, weekly ranges, exit criteria and season decisions (1-3 min).'
        : 'Deciding phases, weekly targets and the strength programme. The longest step (1-3 min).'}</p>;
      return (
        <div className="text-[12px] space-y-1" style={muted}>
          <div className="font-medium" style={{ color: 'var(--rc-ink-2)' }}>{build.outline.planName}</div>
          <div>{build.outline.rationale}</div>
          <div>{build.outline.phases.map((p) => `${p.name} (wk ${p.weeks})`).join(' → ')}</div>
        </div>
      );
    case 'outlined':
      return state === 'active'
        ? <p className="text-[12px]" style={muted}>Each phase written by its own coach against the outline, at the same time.</p>
        : null;
    case 'written':
      if (!build.checks) return <p className="text-[12px]" style={muted}>{build.kind === 'season'
        ? 'Covers the season, ends on race week, starts from your load, no leaps, reaches the race demand…'
        : 'Ramp rates, training days, strength placement, recovery weeks, taper, targets…'}</p>;
      return (
        <p className="text-[12px]" style={muted}>
          {build.checks.errors === 0 ? 'All rules pass' : `${build.checks.errors} rule problem(s) left`}
          {build.checks.repairedWeeks.length > 0 && ` · rewrote ${build.kind === 'season' ? 'phase' : 'week'} ${build.checks.repairedWeeks.join(', ')} to fix breaks`}
          {build.checks.warnings > 0 && ` · ${build.checks.warnings} note(s)`}
        </p>
      );
    case 'checked':
      if (build.reviews.length === 0) return <p className="text-[12px]" style={muted}>{build.kind === 'season'
        ? 'Phase joins, separate tracks for km / climbing / descent, reachable exit criteria, season vs race.'
        : 'Phase joins, recovery alignment, weeks vs outline, plan vs race.'}</p>;
      return (
        <div className="text-[12px] space-y-1" style={muted}>
          {build.reviews.map((r) => (
            <div key={r.round}>
              Round {r.round}: {r.mustFix > 0 ? `${r.mustFix} thing(s) to fix` : 'fits together'} — {r.summary}
            </div>
          ))}
          {build.stage === 'coherence_fix' && <div>Rewriting the affected {build.kind === 'season' ? 'phases' : 'weeks'}…</div>}
        </div>
      );
    default:
      return null;
  }
}
