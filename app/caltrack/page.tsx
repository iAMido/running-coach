'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  Target,
  Scale,
  Droplets,
  UtensilsCrossed,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
  Legend,
} from 'recharts';
import { KpiCard } from '@/components/caltrack/kpi-card';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';
import { Skeleton } from '@/components/ui/skeleton';

interface OverviewData {
  profile: {
    current_weight_kg: number;
    target_weight_kg: number;
    target_daily_calories: number;
    bmr: number;
    tdee: number;
  } | null;
  today: {
    calories: number;
    target: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    meals: number;
  };
  stats: {
    avgCalories: number;
    daysWithData: number;
    currentWeight: number;
    targetWeight: number;
  };
  trend: {
    date: string;
    calories_in: number;
    calories_out: number;
    net: number;
    target: number;
  }[];
  weightTrend: { date: string; weight: number }[];
}

const MACRO_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7'];

export default function CaltrackOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/caltrack/overview?days=${days}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">
          Could not load CalTrack data. Check that CalTrack Supabase is
          configured.
        </p>
      </div>
    );
  }

  const { today, stats, trend, weightTrend, profile } = data;
  const remaining = today.target - today.calories;
  const totalMacroG = today.protein + today.carbs + today.fat;
  const macroData = [
    {
      name: 'Protein',
      value: today.protein,
      pct: totalMacroG > 0 ? Math.round((today.protein / totalMacroG) * 100) : 0,
    },
    {
      name: 'Carbs',
      value: today.carbs,
      pct: totalMacroG > 0 ? Math.round((today.carbs / totalMacroG) * 100) : 0,
    },
    {
      name: 'Fat',
      value: today.fat,
      pct: totalMacroG > 0 ? Math.round((today.fat / totalMacroG) * 100) : 0,
    },
    {
      name: 'Fiber',
      value: today.fiber,
      pct: 0,
    },
  ];

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CalTrack</h1>
          <p className="text-muted-foreground text-sm">
            {stats.currentWeight
              ? `${stats.currentWeight} kg → ${stats.targetWeight} kg`
              : 'Nutrition & weight tracker'}
          </p>
        </div>
        <DateRangePicker selectedDays={days} onChange={setDays} />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Today"
          value={`${today.calories.toLocaleString()} kcal`}
          subtitle={`${remaining > 0 ? remaining.toLocaleString() : 0} remaining`}
          icon={Flame}
          color="orange"
        />
        <KpiCard
          title="Target"
          value={`${today.target.toLocaleString()} kcal`}
          subtitle={profile ? `TDEE: ${profile.tdee}` : undefined}
          icon={Target}
          color="blue"
        />
        <KpiCard
          title="Avg / Day"
          value={`${stats.avgCalories.toLocaleString()} kcal`}
          subtitle={`${stats.daysWithData} days tracked`}
          icon={UtensilsCrossed}
          color="green"
        />
        <KpiCard
          title="Weight"
          value={stats.currentWeight ? `${stats.currentWeight} kg` : '—'}
          subtitle={
            stats.targetWeight
              ? `Goal: ${stats.targetWeight} kg`
              : undefined
          }
          icon={Scale}
          color="purple"
          trend={
            weightTrend.length >= 2
              ? {
                  value:
                    Math.round(
                      (weightTrend[weightTrend.length - 1].weight -
                        weightTrend[0].weight) *
                        10
                    ) / 10,
                  label: `over ${days}d`,
                }
              : undefined
          }
        />
      </div>

      {/* Calorie Trend Chart */}
      <div className="bg-card border border-border rounded-xl p-4 md:p-6">
        <h2 className="text-lg font-semibold mb-4">Calorie Trend</h2>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="colorCalIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorCalOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                labelFormatter={formatDate}
              />
              <Legend />
              <ReferenceLine
                y={today.target}
                stroke="#3b82f6"
                strokeDasharray="5 5"
                label={{ value: 'Target', fill: '#3b82f6', fontSize: 11 }}
              />
              <Area
                type="monotone"
                dataKey="calories_in"
                name="Intake"
                stroke="#f97316"
                fill="url(#colorCalIn)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="calories_out"
                name="Exercise"
                stroke="#22c55e"
                fill="url(#colorCalOut)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data for this period
          </div>
        )}
      </div>

      {/* Bottom Row: Macros + Weight */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Macro Breakdown */}
        <div className="bg-card border border-border rounded-xl p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4">Today&apos;s Macros</h2>
          {totalMacroG > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={macroData.slice(0, 3)}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {macroData.slice(0, 3).map((_, index) => (
                      <Cell key={index} fill={MACRO_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => `${Math.round(Number(value))}g`}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3 flex-1">
                {macroData.map((m, i) => (
                  <div key={m.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: MACRO_COLORS[i] }}
                      />
                      <span className="text-sm">{m.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">
                        {Math.round(m.value)}g
                      </span>
                      {m.pct > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({m.pct}%)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              No meals logged today
            </div>
          )}
        </div>

        {/* Weight Trend */}
        <div className="bg-card border border-border rounded-xl p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4">Weight Trend</h2>
          {weightTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={weightTrend}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
                  tick={{ fontSize: 11 }}
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
                {stats.targetWeight && (
                  <ReferenceLine
                    y={stats.targetWeight}
                    stroke="#22c55e"
                    strokeDasharray="5 5"
                    label={{
                      value: `Goal: ${stats.targetWeight}`,
                      fill: '#22c55e',
                      fontSize: 11,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#a855f7' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              No weight data for this period
            </div>
          )}
        </div>
      </div>

      {/* Today's Meals Quick View */}
      <div className="bg-card border border-border rounded-xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Today ({today.meals} meals)
          </h2>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Droplets className="w-4 h-4 text-blue-500" />
              Water: check /status
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-orange-500/5 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Calories</p>
            <p className="text-xl font-bold text-orange-600">
              {today.calories}
            </p>
          </div>
          <div className="bg-blue-500/5 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Protein</p>
            <p className="text-xl font-bold text-blue-600">
              {Math.round(today.protein)}g
            </p>
          </div>
          <div className="bg-green-500/5 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Carbs</p>
            <p className="text-xl font-bold text-green-600">
              {Math.round(today.carbs)}g
            </p>
          </div>
          <div className="bg-purple-500/5 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Fat</p>
            <p className="text-xl font-bold text-purple-600">
              {Math.round(today.fat)}g
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
