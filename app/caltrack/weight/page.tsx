'use client';

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';
import { Scale, TrendingDown, TrendingUp } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface WeightPoint {
  date: string;
  weight: number;
}

export default function WeightPage() {
  const [weights, setWeights] = useState<WeightPoint[]>([]);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [targetWeight, setTargetWeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/caltrack/weight?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setWeights(data.weights);
        setCurrentWeight(data.currentWeight);
        setTargetWeight(data.targetWeight);
      }
    } catch (err) {
      console.error('Failed to fetch weight data:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (label: unknown) => {
    const d = new Date(String(label) + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const change =
    weights.length >= 2
      ? Math.round((weights[weights.length - 1].weight - weights[0].weight) * 10) / 10
      : null;

  const toGoal =
    currentWeight && targetWeight
      ? Math.round((currentWeight - targetWeight) * 10) / 10
      : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Weight</h1>
          <p className="text-muted-foreground text-sm">
            {weights.length} measurements in the last {days} days
          </p>
        </div>
        <DateRangePicker selectedDays={days} onChange={setDays} />
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-purple-500" />
            <p className="text-sm text-muted-foreground">Current</p>
          </div>
          <p className="text-2xl font-bold">
            {currentWeight ? `${currentWeight} kg` : '—'}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            {change !== null && change <= 0 ? (
              <TrendingDown className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingUp className="w-4 h-4 text-red-500" />
            )}
            <p className="text-sm text-muted-foreground">Change ({days}d)</p>
          </div>
          <p className="text-2xl font-bold">
            {change !== null
              ? `${change > 0 ? '+' : ''}${change} kg`
              : '—'}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-blue-500" />
            <p className="text-sm text-muted-foreground">To Goal</p>
          </div>
          <p className="text-2xl font-bold">
            {toGoal !== null ? `${toGoal} kg` : '—'}
          </p>
          {targetWeight && (
            <p className="text-xs text-muted-foreground">
              Target: {targetWeight} kg
            </p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-6">
        <h2 className="text-lg font-semibold mb-4">Weight History</h2>
        {weights.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={weights}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                domain={['dataMin - 0.5', 'dataMax + 0.5']}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                labelFormatter={formatDate}
                formatter={(value) => [`${value} kg`, 'Weight']}
              />
              {targetWeight && (
                <ReferenceLine
                  y={targetWeight}
                  stroke="#22c55e"
                  strokeDasharray="5 5"
                  label={{
                    value: `Goal: ${targetWeight} kg`,
                    fill: '#22c55e',
                    fontSize: 11,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="weight"
                stroke="#a855f7"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#a855f7' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No weight data for this period. Log with /weight in Telegram.
          </div>
        )}
      </div>

      {/* Weight log table */}
      {weights.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4">Log</h2>
          <div className="space-y-1">
            {[...weights].reverse().map((w, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-sm"
              >
                <span className="text-muted-foreground">{formatDate(w.date)}</span>
                <span className="font-medium">{w.weight} kg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
