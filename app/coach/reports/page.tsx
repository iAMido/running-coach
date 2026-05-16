'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Calendar, ArrowLeft, Activity, Brain } from 'lucide-react';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Report {
  id: string;
  report_type: string;
  title: string;
  content?: string;
  week_start: string;
  week_end: string;
  metadata: {
    runs_count?: number;
    total_km?: number;
    overall_feeling?: number;
    sleep_quality?: number;
    stress_level?: number;
  };
  created_at: string;
}

export default function CoachReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const response = await fetch('/api/coach/reports?limit=50');
      const data = await response.json();
      setReports(data.reports || []);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const openReport = async (id: string) => {
    setLoadingReport(true);
    try {
      const response = await fetch(`/api/coach/reports?id=${id}`);
      const data = await response.json();
      if (data.report) {
        setSelectedReport(data.report);
      }
    } catch (error) {
      console.error('Failed to fetch report:', error);
    } finally {
      setLoadingReport(false);
    }
  };

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  if (selectedReport) {
    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          onClick={() => setSelectedReport(null)}
          className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--rc-ink-3)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to reports
        </button>

        {/* Report header */}
        <div>
          <div className="rc-kicker flex items-center gap-2.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
            {selectedReport.week_start && selectedReport.week_end
              ? formatDateRange(selectedReport.week_start, selectedReport.week_end)
              : new Date(selectedReport.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <h1
            className="text-[28px] md:text-[36px] font-bold leading-[1.1]"
            style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
          >
            {selectedReport.title}
          </h1>
        </div>

        {/* Quick stats */}
        {selectedReport.metadata && (
          <div className="flex flex-wrap gap-3">
            {selectedReport.metadata.runs_count != null && (
              <div className="rc-mono text-[11px] px-3 py-1.5 rounded-full" style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)', border: '1px solid var(--rc-line)' }}>
                <Activity className="w-3 h-3 inline mr-1.5" style={{ color: 'var(--rc-blue)' }} />
                {selectedReport.metadata.runs_count} RUNS
              </div>
            )}
            {selectedReport.metadata.total_km != null && (
              <div className="rc-mono text-[11px] px-3 py-1.5 rounded-full" style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)', border: '1px solid var(--rc-line)' }}>
                {selectedReport.metadata.total_km.toFixed(1)} KM
              </div>
            )}
            {selectedReport.metadata.overall_feeling != null && (
              <div className="rc-mono text-[11px] px-3 py-1.5 rounded-full" style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)', border: '1px solid var(--rc-line)' }}>
                FEELING {selectedReport.metadata.overall_feeling}/10
              </div>
            )}
          </div>
        )}

        {/* Report content */}
        <div
          className="relative rounded-[28px] overflow-hidden"
          style={{ background: 'var(--rc-ink)', color: '#FBFAF6' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(700px 320px at 105% 110%, oklch(0.45 0.16 245 / 0.55), transparent 60%)',
            }}
          />
          <div className="relative p-8">
            <div className="rc-kicker mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <Brain className="w-4 h-4 inline mr-2" />
              COACH&apos;S ANALYSIS
            </div>
            <div className="prose prose-invert prose-sm max-w-none [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_ul]:space-y-1 [&_li]:text-sm [&_p]:text-sm [&_p]:leading-relaxed [&_strong]:text-white" style={{ color: 'rgba(255,255,255,0.85)' }}>
              <ReactMarkdown>{selectedReport.content || ''}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="rc-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
          COACH REPORTS
        </div>
        <h1
          className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
          style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
        >
          Your coach{' '}
          <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--rc-ink-2)' }}>
            feedback.
          </span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--rc-ink-3)' }}>
          All your weekly reviews and coach analyses in one place.
        </p>
      </div>

      {/* Reports list */}
      <div className="rc-card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
          <div>
            <div className="rc-kicker mb-1">History</div>
            <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Weekly reviews</h3>
          </div>
          <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
            <FileText className="w-4 h-4" />
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" style={{ background: 'rgba(14,15,12,0.06)' }} />
            ))}
          </div>
        ) : reports.length > 0 ? (
          <div>
            {reports.map((report) => (
              <div
                key={report.id}
                onClick={() => openReport(report.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openReport(report.id)}
                className="relative grid items-center gap-4 px-6 py-5 transition-colors cursor-pointer hover:bg-black/[0.02]"
                style={{
                  gridTemplateColumns: '40px 1fr auto',
                  borderBottom: '1px solid var(--rc-line)',
                }}
              >
                <div
                  className="w-10 h-10 rounded-[10px] grid place-items-center"
                  style={{ background: 'oklch(0.96 0.04 240)', color: 'var(--rc-blue-deep)' }}
                >
                  <Brain className="w-4.5 h-4.5" />
                </div>
                <div>
                  <div className="text-[14.5px] font-semibold" style={{ letterSpacing: '-0.005em', color: 'var(--rc-ink)' }}>
                    {report.title}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="rc-mono text-[11px] uppercase" style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.06em' }}>
                      <Calendar className="w-3 h-3 inline mr-1" />
                      {report.week_start && report.week_end
                        ? formatDateRange(report.week_start, report.week_end)
                        : new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    {report.metadata?.runs_count != null && (
                      <div className="rc-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}>
                        {report.metadata.runs_count} RUNS · {report.metadata.total_km?.toFixed(1)} KM
                      </div>
                    )}
                  </div>
                </div>
                <div className="rc-mono text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>
                  {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--rc-ink-3)' }}>
            <FileText className="w-10 h-10 mb-3" style={{ color: 'var(--rc-ink-4)' }} />
            <p className="text-sm font-medium">No reports yet</p>
            <p className="text-xs mt-1">Run a Weekly Review analysis to generate your first report.</p>
          </div>
        )}
      </div>

      {loadingReport && (
        <div className="fixed inset-0 bg-black/20 grid place-items-center z-50">
          <div className="rc-card p-8 flex items-center gap-3">
            <Brain className="w-5 h-5 animate-pulse" style={{ color: 'var(--rc-blue)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--rc-ink)' }}>Loading report...</span>
          </div>
        </div>
      )}
    </div>
  );
}
