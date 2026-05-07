'use client';

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';
import { Activity, Flame, Clock, Route } from 'lucide-react';
import { KpiCard } from '@/components/caltrack/kpi-card';
import type { CaltrackRun } from '@/lib/db/caltrack-types';

function formatPace(secPerKm: number | null) {
  if (!secPerKm) return '—';
  const min = Math.floor(secPerKm / 60);
  const sec = secPerKm % 60;
  return `${min}:${String(sec).padStart(2, '0')}/km`;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<CaltrackRun[]>([]);
  const [stats, setStats] = useState({
    totalRuns: 0,
    totalDistance: 0,
    totalCalories: 0,
    totalDuration: 0,
  });
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/caltrack/runs?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground text-sm">
            Activity from the last {days} days
          </p>
        </div>
        <DateRangePicker selectedDays={days} onChange={setDays} />
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Runs"
          value={stats.totalRuns}
          icon={Activity}
          color="green"
        />
        <KpiCard
          title="Distance"
          value={`${stats.totalDistance} km`}
          icon={Route}
          color="blue"
        />
        <KpiCard
          title="Calories"
          value={`${stats.totalCalories.toLocaleString()}`}
          subtitle="kcal burned"
          icon={Flame}
          color="orange"
        />
        <KpiCard
          title="Time"
          value={formatDuration(stats.totalDuration)}
          icon={Clock}
          color="purple"
        />
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Activity className="w-10 h-10 mb-2 opacity-50" />
          <p>No runs logged in this period</p>
          <p className="text-xs mt-1">
            Use /run or /syncstrava in Telegram
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{run.distance_km} km</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(run.run_date)}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-sm font-medium">
                    {formatPace(run.avg_pace_sec_per_km)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(run.duration_minutes)} |{' '}
                    {run.calories_burned} kcal
                    {run.avg_heart_rate ? ` | ${run.avg_heart_rate} bpm` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {run.source}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
