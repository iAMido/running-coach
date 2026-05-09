'use client';

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';
import { Scale, TrendingDown, TrendingUp, Plus, Target, ArrowDown } from 'lucide-react';
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
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [newWeight, setNewWeight] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = customRange
        ? `from=${customRange.from}&to=${customRange.to}`
        : `days=${days}`;
      const res = await fetch(`/api/caltrack/weight?${params}`);
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
  }, [days, customRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLogWeight = async () => {
    const kg = parseFloat(newWeight);
    if (!kg || kg < 20 || kg > 300) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/caltrack/weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg: kg }),
      });
      if (res.ok) {
        setNewWeight('');
        setShowForm(false);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to log weight:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (label: unknown) => {
    const d = new Date(String(label) + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          <Skeleton className="h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
          <Skeleton className="h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
          <Skeleton className="h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
        </div>
        <Skeleton className="h-72" style={{ background: 'rgba(14,15,12,0.06)' }} />
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

  const progressToGoal =
    currentWeight && targetWeight && weights.length > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((weights[0].weight - currentWeight) / (weights[0].weight - targetWeight)) * 100
          )
        )
      : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <div className="ct-kicker mb-2">
            <span
              className="inline-block w-[6px] h-[6px] rounded-full mr-2"
              style={{ background: 'var(--ct-ember)' }}
            />
            BODY COMPOSITION
          </div>
          <h1
            className="text-[36px] md:text-[44px] font-bold leading-[1.05]"
            style={{ letterSpacing: '-0.03em', color: 'var(--ct-ink)' }}
          >
            Weight <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--ct-ink-2)' }}>tracking.</span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ct-ink-3)' }}>
            {weights.length} measurements · last {days === -1 ? 'custom range' : `${days} days`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-white transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            <Plus className="w-4 h-4" />
            Log Weight
          </button>
          <DateRangePicker
            selectedDays={days}
            onChange={(d) => { setDays(d); setCustomRange(undefined); }}
            customRange={customRange}
            onCustomRange={(from, to) => { setCustomRange({ from, to }); setDays(-1); }}
          />
        </div>
      </div>

      {/* Weight Input Form */}
      {showForm && (
        <div
          className="ct-card flex items-center gap-3 p-4"
          style={{ border: '2px solid var(--ct-ember)', boxShadow: 'var(--ct-shadow-2)' }}
        >
          <Scale className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--ct-ember)' }} />
          <input
            type="number"
            step="0.1"
            min="20"
            max="300"
            placeholder={currentWeight ? `${currentWeight}` : 'Weight in kg'}
            value={newWeight}
            onChange={(e) => setNewWeight(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogWeight()}
            className="flex-1 px-3 py-2 rounded-lg text-sm ct-mono focus:outline-none focus:ring-2"
            style={{
              border: '1px solid var(--ct-line)',
              background: 'var(--ct-surface-2)',
              color: 'var(--ct-ink)',
            }}
            autoFocus
          />
          <span className="text-sm ct-mono" style={{ color: 'var(--ct-ink-3)' }}>kg</span>
          <button
            onClick={handleLogWeight}
            disabled={submitting || !newWeight}
            className="px-5 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-50 transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {/* Current Weight — Big Number */}
        <div className="ct-stat relative overflow-hidden">
          <div className="flex items-center justify-between mb-3.5">
            <span className="ct-kicker">CURRENT</span>
            <span
              className="w-[22px] h-[22px] rounded-[7px] grid place-items-center"
              style={{ background: 'var(--ct-ember-soft)', color: 'var(--ct-ember)' }}
            >
              <Scale className="w-3 h-3" />
            </span>
          </div>
          <div
            className="ct-mono text-[32px] font-bold leading-none"
            style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
          >
            {currentWeight ? currentWeight : '—'}
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kg</span>
          </div>
        </div>

        {/* Change */}
        <div className="ct-stat relative overflow-hidden">
          <div className="flex items-center justify-between mb-3.5">
            <span className="ct-kicker">CHANGE ({days === -1 ? 'range' : `${days}D`})</span>
            <span
              className="w-[22px] h-[22px] rounded-[7px] grid place-items-center"
              style={{
                background: change !== null && change <= 0 ? 'rgba(76,175,80,0.1)' : 'rgba(239,83,80,0.1)',
                color: change !== null && change <= 0 ? 'var(--ct-good)' : 'var(--ct-bad)',
              }}
            >
              {change !== null && change <= 0 ? (
                <TrendingDown className="w-3 h-3" />
              ) : (
                <TrendingUp className="w-3 h-3" />
              )}
            </span>
          </div>
          <div
            className="ct-mono text-[32px] font-bold leading-none"
            style={{
              letterSpacing: '-0.025em',
              color: change !== null && change <= 0 ? 'var(--ct-good)' : change !== null ? 'var(--ct-bad)' : 'var(--ct-ink)',
            }}
          >
            {change !== null ? `${change > 0 ? '+' : ''}${change}` : '—'}
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kg</span>
          </div>
        </div>

        {/* Goal Card — Dark */}
        <div
          className="rounded-2xl p-5 relative overflow-hidden"
          style={{
            background: 'var(--ct-ink)',
            boxShadow: 'var(--ct-shadow-2)',
          }}
        >
          <div className="flex items-center justify-between mb-3.5">
            <span
              className="ct-mono text-[9.5px] font-medium uppercase"
              style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em' }}
            >
              GOAL
            </span>
            <span
              className="w-[22px] h-[22px] rounded-[7px] grid place-items-center"
              style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--ct-ember)' }}
            >
              <Target className="w-3 h-3" />
            </span>
          </div>
          <div
            className="ct-mono text-[32px] font-bold leading-none text-white"
            style={{ letterSpacing: '-0.025em' }}
          >
            {targetWeight ?? '—'}
            <span className="text-sm font-medium ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>kg</span>
          </div>
          {toGoal !== null && (
            <div className="mt-2.5 text-xs flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <ArrowDown className="w-3 h-3" style={{ color: 'var(--ct-ember)' }} />
              <span className="font-semibold" style={{ color: 'var(--ct-ember)' }}>{toGoal} kg</span>
              to go
            </div>
          )}
          {typeof progressToGoal === 'number' && (
            <div className="mt-3 flex items-center gap-3">
              <div
                className="flex-1 h-[5px] rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.1)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(progressToGoal, 100)}%`,
                    background: 'var(--ct-ember)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="ct-card p-5 md:p-7">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="ct-kicker mb-1">SERIES 01</div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--ct-ink)' }}>Weight Trend</h2>
          </div>
        </div>
        {weights.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={weights}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--ct-line)"
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 11, fill: 'var(--ct-ink-3)', fontFamily: 'var(--font-mono, monospace)' }}
                axisLine={{ stroke: 'var(--ct-line)' }}
                tickLine={false}
              />
              <YAxis
                domain={['dataMin - 0.5', 'dataMax + 0.5']}
                tick={{ fontSize: 11, fill: 'var(--ct-ink-3)', fontFamily: 'var(--font-mono, monospace)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--ct-surface)',
                  border: '1px solid var(--ct-line)',
                  borderRadius: '12px',
                  fontSize: '13px',
                  boxShadow: 'var(--ct-shadow-2)',
                  color: 'var(--ct-ink)',
                }}
                labelFormatter={formatDate}
                formatter={(value) => [`${value} kg`, 'Weight']}
              />
              {targetWeight && (
                <ReferenceLine
                  y={targetWeight}
                  stroke="var(--ct-good)"
                  strokeDasharray="5 5"
                  label={{
                    value: `Goal: ${targetWeight} kg`,
                    fill: 'var(--ct-good)',
                    fontSize: 11,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="weight"
                stroke="var(--ct-ember)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'var(--ct-ember)', stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: 'var(--ct-ember)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex flex-col items-center justify-center h-48 rounded-xl"
            style={{ border: '2px dashed var(--ct-line)', color: 'var(--ct-ink-3)' }}
          >
            <Scale className="w-8 h-8 mb-2" style={{ color: 'var(--ct-ink-4)' }} />
            <span className="text-sm">No weight data for this period</span>
            <span className="text-xs mt-1" style={{ color: 'var(--ct-ink-4)' }}>Log with /weight in Telegram or use the button above</span>
          </div>
        )}
      </div>

      {/* Weight Ledger */}
      {weights.length > 0 && (
        <div className="ct-card p-5 md:p-7">
          <div className="ct-kicker mb-1">LEDGER</div>
          <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--ct-ink)' }}>Weight Log</h2>
          <div className="divide-y" style={{ borderColor: 'var(--ct-line)' }}>
            {[...weights].reverse().map((w, i) => {
              const prev = i < weights.length - 1 ? [...weights].reverse()[i + 1] : null;
              const diff = prev ? Math.round((w.weight - prev.weight) * 10) / 10 : null;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  style={{ borderColor: 'var(--ct-line)' }}
                >
                  <span className="ct-mono text-sm" style={{ color: 'var(--ct-ink-3)' }}>
                    {formatDate(w.date)}
                  </span>
                  <div className="flex items-center gap-3">
                    {diff !== null && (
                      <span
                        className="ct-mono text-xs font-medium"
                        style={{ color: diff <= 0 ? 'var(--ct-good)' : 'var(--ct-bad)' }}
                      >
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                    <span
                      className="ct-mono text-sm font-bold"
                      style={{ color: 'var(--ct-ink)' }}
                    >
                      {w.weight} kg
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
