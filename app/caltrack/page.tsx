'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  Target,
  Scale,
  Droplets,
  UtensilsCrossed,
  Footprints,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
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
  ReferenceArea,
  ReferenceLine,
  Legend,
  Scatter,
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
    exercise: number;
    exerciseRuns: number;
    exerciseDistance: number;
  };
  stats: {
    avgCalories: number;
    daysWithData: number;
    currentWeight: number;
    targetWeight: number;
    totalExerciseCalories: number;
    totalExerciseRuns: number;
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
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = customRange
        ? `from=${customRange.from}&to=${customRange.to}`
        : `days=${days}`;
      const res = await fetch(`/api/caltrack/overview?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    } finally {
      setLoading(false);
    }
  }, [days, customRange]);

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
  // If you exercise, you "earn back" those calories
  const remaining = today.target + today.exercise - today.calories;
  const netCalories = today.calories - today.exercise;
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

  const formatDate = (label: unknown) => {
    const d = new Date(String(label) + 'T00:00:00');
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
        <DateRangePicker
          selectedDays={days}
          onChange={(d) => { setDays(d); setCustomRange(undefined); }}
          customRange={customRange}
          onCustomRange={(from, to) => { setCustomRange({ from, to }); setDays(-1); }}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          title="Eaten Today"
          value={`${today.calories.toLocaleString()} kcal`}
          subtitle={
            today.exercise > 0
              ? `Net: ${netCalories.toLocaleString()} · ${remaining > 0 ? remaining.toLocaleString() : 0} left`
              : `${remaining > 0 ? remaining.toLocaleString() : 0} remaining`
          }
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
          title="Exercise"
          value={today.exercise > 0 ? `${today.exercise} kcal` : '0 kcal'}
          subtitle={
            today.exerciseRuns > 0
              ? `${today.exerciseRuns} run${today.exerciseRuns > 1 ? 's' : ''} · ${today.exerciseDistance} km`
              : 'No runs today'
          }
          icon={Footprints}
          color="green"
        />
        <KpiCard
          title="Avg / Day"
          value={`${stats.avgCalories.toLocaleString()} kcal`}
          subtitle={`${stats.daysWithData} days tracked`}
          icon={UtensilsCrossed}
          color="orange"
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
        <h2 className="text-lg font-semibold mb-4">Daily Calories</h2>
        {trend.length > 0 ? (() => {
          // Transform data: stacked bar = net (bottom) + exercise (top, subtracted visually)
          // Net sits on baseline, exercise stacks on top to show total eaten
          const chartData = trend.map((d) => ({
            date: d.date,
            // The net portion (eaten minus exercise)
            net: Math.max(d.calories_in - d.calories_out, 0),
            // Exercise stacks on top of net to reconstruct total eaten
            exercise: d.calories_out,
            // For the net dot indicator
            netValue: d.calories_in - d.calories_out,
            // Raw values for tooltip
            eaten: d.calories_in,
            burned: d.calories_out,
            target: d.target,
          }));

          const maxCal = Math.max(
            ...chartData.map((d) => d.eaten),
            today.target
          );

          return (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} barSize={40}>
                {/* Fix 4: Success zone — faint green below target */}
                <ReferenceArea
                  y1={0}
                  y2={today.target}
                  fill="#22c55e"
                  fillOpacity={0.04}
                />
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                  domain={[0, Math.ceil(maxCal * 1.15 / 100) * 100]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  labelFormatter={formatDate}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    if (!d) return null;
                    const isUnder = d.netValue <= d.target;
                    return (
                      <div
                        style={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          fontSize: '13px',
                        }}
                      >
                        <p style={{ fontWeight: 600, marginBottom: 4 }}>
                          {formatDate(label)}
                        </p>
                        <p>
                          <span style={{ color: '#f97316' }}>Eaten:</span>{' '}
                          {d.eaten.toLocaleString()} kcal
                        </p>
                        {d.burned > 0 && (
                          <p>
                            <span style={{ color: '#22c55e' }}>Exercise:</span>{' '}
                            -{d.burned.toLocaleString()} kcal
                          </p>
                        )}
                        <p style={{
                          fontWeight: 600,
                          color: isUnder ? '#6366f1' : '#ef4444',
                          marginTop: 4,
                        }}>
                          Net: {d.netValue.toLocaleString()} kcal
                          {isUnder ? ' ✓' : ' ▲'}
                        </p>
                        <p style={{ color: '#94a3b8', fontSize: '11px' }}>
                          Target: {d.target.toLocaleString()} kcal
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend
                  formatter={(value) => {
                    if (value === 'net') return 'Net calories';
                    if (value === 'exercise') return 'Exercise (burned)';
                    return value;
                  }}
                />

                {/* Target line */}
                <ReferenceLine
                  y={today.target}
                  stroke="#3b82f6"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  label={{ value: 'Target', fill: '#3b82f6', fontSize: 11 }}
                />

                {/* Fix 1: Stacked bar — net on bottom (orange), exercise on top (green) */}
                {/* The full height = net + exercise = total eaten */}
                {/* Exercise visually "subtracts" from the top */}
                <Bar
                  dataKey="net"
                  name="net"
                  stackId="calories"
                  fill="#f97316"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="exercise"
                  name="exercise"
                  stackId="calories"
                  fill="#22c55e"
                  opacity={0.7}
                  radius={[4, 4, 0, 0]}
                />

                {/* Fix 2 & 3: Net dots (no connecting line) — color by target */}
                <Scatter
                  dataKey="netValue"
                  name="Net"
                  fill="#6366f1"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  shape={(props: any) => {
                    const isOver = props.payload.netValue > props.payload.target;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={6}
                        fill={isOver ? '#ef4444' : '#6366f1'}
                        stroke="white"
                        strokeWidth={2}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          );
        })() : (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data for this period
          </div>
        )}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#6366f1]" /> Under target
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" /> Over target
          </span>
          <span className="ml-auto">Net = Eaten − Exercise</span>
        </div>
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
