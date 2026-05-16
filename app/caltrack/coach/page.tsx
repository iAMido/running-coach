'use client';

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, BookOpen, RefreshCw } from 'lucide-react';
import type { CoachReport } from '@/lib/db/caltrack-types';

function formatWeekLabel(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

function formatCreatedAt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ReportCard({ report }: { report: CoachReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', boxShadow: 'var(--ct-shadow-1)' }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left transition-colors"
        style={{ background: expanded ? 'var(--ct-surface-2)' : 'transparent' }}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-[16px] font-semibold" style={{ color: 'var(--ct-ink)', letterSpacing: '-0.01em' }}>
              {formatWeekLabel(report.week_start, report.week_end)}
            </div>
            <div className="ct-mono text-[11px] mt-0.5" style={{ color: 'var(--ct-ink-4)', letterSpacing: '0.04em' }}>
              Generated {formatCreatedAt(report.created_at)}
            </div>
          </div>
          <div
            className="w-[30px] h-[30px] grid place-items-center rounded-lg shrink-0"
            style={{ background: 'var(--ct-surface-2)', border: '1px solid var(--ct-line)', color: 'var(--ct-ink-3)' }}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div
          className="px-5 py-4 text-sm leading-relaxed"
          style={{
            borderTop: '1px solid var(--ct-line)',
            background: 'var(--ct-surface-2)',
            color: 'var(--ct-ink)',
            whiteSpace: 'pre-wrap',
            direction: 'rtl',
            fontFamily: 'inherit',
          }}
        >
          {report.report_text}
        </div>
      )}
    </div>
  );
}

export default function CoachReportsPage() {
  const [reports, setReports] = useState<CoachReport[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/caltrack/coach-reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to fetch coach reports:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20" style={{ background: 'rgba(14,15,12,0.06)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <div className="ct-kicker mb-2">
            <span className="inline-block w-[6px] h-[6px] rounded-full mr-2" style={{ background: 'var(--ct-ember)' }} />
            AI COACH · WEEKLY REPORTS
          </div>
          <h1
            className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
            style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
          >
            Coach,{' '}
            <span
              className="font-normal italic"
              style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ct-ink)' }}
            >
              in Hebrew.
            </span>
          </h1>
          <p className="mt-2.5 text-sm" style={{ color: 'var(--ct-ink-3)', maxWidth: 520 }}>
            Weekly AI analysis of your food, exercise, and weight trend.
            Reports are generated every Saturday at 22:00 and sent to Telegram.
          </p>
        </div>
        <button
          onClick={fetchReports}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium transition-colors"
          style={{ border: '1px solid var(--ct-line)', color: 'var(--ct-ink-3)', background: 'var(--ct-surface)', boxShadow: 'var(--ct-shadow-1)' }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Stats strip */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Reports saved', value: String(reports.length) },
            { label: 'Latest week', value: formatWeekLabel(reports[0].week_start, reports[0].week_end) },
            { label: 'First report', value: formatWeekLabel(reports[reports.length - 1].week_start, reports[reports.length - 1].week_end) },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-[14px] px-[18px] py-4"
              style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', boxShadow: 'var(--ct-shadow-1)' }}
            >
              <div className="ct-mono text-[10.5px] font-medium uppercase" style={{ color: 'var(--ct-ink-3)', letterSpacing: '0.1em' }}>
                {c.label}
              </div>
              <div className="mt-1.5 font-bold text-[15px]" style={{ color: 'var(--ct-ink)', letterSpacing: '-0.01em' }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reports list */}
      {reports.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 rounded-2xl"
          style={{ border: '2px dashed var(--ct-line)', color: 'var(--ct-ink-3)' }}
        >
          <BookOpen className="w-10 h-10 mb-3" style={{ color: 'var(--ct-ink-4)' }} />
          <p className="text-sm font-medium">No coach reports yet</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--ct-ink-4)' }}>
            The first report will be generated this Saturday at 22:00 and saved here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
