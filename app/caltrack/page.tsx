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
  Scatter,
} from 'recharts';
import { KpiCard } from '@/components/caltrack/kpi-card';
import { DateRangePicker } from '@/components/caltrack/date-range-picker';

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
    water_ml: number;
    water_target_ml: number;
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

const MACRO_COLORS = ['oklch(0.66 0.19 38)', 'oklch(0.58 0.17 245)', 'oklch(0.62 0.13 150)', 'oklch(0.55 0.18 305)'];

export default function CaltrackOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [addingWater, setAddingWater] = useState(false);

  const addWater = async (ml: number) => {
    setAddingWater(true);
    try {
      const res = await fetch('/api/caltrack/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_ml: ml }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Failed to log water:', err);
    } finally {
      setAddingWater(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = customRange
        ? `from=${customRange.from}&to=${customRange.to}`
        : `days=${days}`;
      const res = await fetch(`/api/caltrack/overview?${params}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    } finally {
      setLoading(false);
    }
  }, [days, customRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl animate-pulse">
        <div className="h-10 w-48 rounded-lg" style={{ background: 'var(--ct-line)' }} />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 rounded-[20px]" style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)' }} />
          ))}
        </div>
        <div className="h-72 rounded-[20px]" style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p style={{ color: 'var(--ct-ink-3)' }}>Could not load CalTrack data.</p>
      </div>
    );
  }

  const { today, stats, trend, weightTrend, profile } = data;
  const remaining = today.target + today.exercise - today.calories;
  const netCalories = today.calories - today.exercise;
  const totalMacroG = today.protein + today.carbs + today.fat;
  const macroData = [
    { name: 'Protein', value: today.protein, pct: totalMacroG > 0 ? Math.round((today.protein / totalMacroG) * 100) : 0 },
    { name: 'Carbs', value: today.carbs, pct: totalMacroG > 0 ? Math.round((today.carbs / totalMacroG) * 100) : 0 },
    { name: 'Fat', value: today.fat, pct: totalMacroG > 0 ? Math.round((today.fat / totalMacroG) * 100) : 0 },
    { name: 'Fiber', value: today.fiber, pct: 0 },
  ];

  const formatDate = (label: unknown) => {
    const d = new Date(String(label) + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page Header — editorial style */}
      <div
        className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 pb-5 mb-2"
        style={{ borderBottom: '1px solid var(--ct-line)' }}
      >
        <div>
          <div className="ct-kicker flex items-center gap-2.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ct-ember)' }} />
            {dayName} &middot; {dateStr}
          </div>
          <h1
            className="text-[44px] font-bold leading-none m-0"
            style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
          >
            Today, <span style={{ fontStyle: 'italic', fontWeight: 500, letterSpacing: '-0.01em' }}>in calories.</span>
          </h1>
          {stats.currentWeight && stats.targetWeight && (
            <p className="mt-2.5 text-sm max-w-[620px]" style={{ color: 'var(--ct-ink-3)' }}>
              {stats.currentWeight} kg &rarr; {stats.targetWeight} kg goal &middot;{' '}
              {Math.round(stats.currentWeight - stats.targetWeight)} kg to lose
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 items-end">
          <DateRangePicker
            selectedDays={days}
            onChange={(d) => { setDays(d); setCustomRange(undefined); }}
            customRange={customRange}
            onCustomRange={(from, to) => { setCustomRange({ from, to }); setDays(-1); }}
          />
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          title="Eaten Today"
          value={<>{today.calories.toLocaleString()}<span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kcal</span></>}
          subtitle={
            today.exercise > 0
              ? `Net: ${netCalories.toLocaleString()} · ${remaining > 0 ? remaining.toLocaleString() : 0} left`
              : `${remaining > 0 ? remaining.toLocaleString() : 0} remaining of ${today.target.toLocaleString()}`
          }
          icon={Flame}
          progress={Math.round((today.calories / today.target) * 100)}
        />
        <KpiCard
          title="Target"
          value={<>{today.target.toLocaleString()}<span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kcal</span></>}
          subtitle={profile ? `TDEE ${profile.tdee} · deficit ${profile.tdee - today.target}` : undefined}
          icon={Target}
        />
        <KpiCard
          title="Exercise"
          value={<>{today.exercise}<span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kcal</span></>}
          subtitle={
            today.exerciseRuns > 0
              ? `${today.exerciseRuns} run${today.exerciseRuns > 1 ? 's' : ''} · ${today.exerciseDistance} km`
              : 'No runs today'
          }
          icon={Footprints}
        />
        <KpiCard
          title="Avg / Day"
          value={<>{stats.avgCalories.toLocaleString()}<span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kcal</span></>}
          subtitle={`${stats.daysWithData} days tracked`}
          icon={UtensilsCrossed}
        />
        <KpiCard
          title="Weight"
          value={stats.currentWeight ? <>{stats.currentWeight}<span className="text-sm font-medium ml-1" style={{ color: 'var(--ct-ink-3)' }}>kg</span></> : <>—</>}
          subtitle={stats.targetWeight ? `Goal ${stats.targetWeight} kg · ${Math.round(stats.currentWeight - stats.targetWeight)} to go` : undefined}
          icon={Scale}
          trend={
            weightTrend.length >= 2
              ? { value: Math.round((weightTrend[weightTrend.length - 1].weight - weightTrend[0].weight) * 10) / 10, label: `over ${days}d` }
              : undefined
          }
        />
      </div>

      {/* Main Grid: Chart + Macros */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Daily Calories Chart */}
        <div className="ct-card">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
            <div>
              <div className="ct-kicker mb-1">Series 01</div>
              <h3 className="text-[18px] font-bold m-0" style={{ letterSpacing: '-0.015em' }}>
                Daily calories — net of exercise
              </h3>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <span className="ct-chip">
                <span className="w-2 h-2 rounded-sm mr-1" style={{ background: 'var(--ct-ember)', display: 'inline-block' }} />
                Eaten
              </span>
              <span className="ct-chip">
                <span className="w-2 h-2 rounded-sm mr-1" style={{ background: 'var(--ct-good)', display: 'inline-block' }} />
                Burned
              </span>
            </div>
          </div>

          <div className="px-4 pb-4">
            {trend.length > 0 ? (() => {
              const chartData = trend.map((d) => ({
                date: d.date,
                net: Math.max(d.calories_in - d.calories_out, 0),
                exercise: d.calories_out,
                netValue: d.calories_in - d.calories_out,
                eaten: d.calories_in,
                burned: d.calories_out,
                target: d.target,
              }));
              const maxCal = Math.max(...chartData.map((d) => d.eaten), today.target);

              return (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} barSize={40}>
                    <ReferenceArea y1={0} y2={today.target} fill="oklch(0.62 0.13 150)" fillOpacity={0.04} />
                    <CartesianGrid stroke="rgba(14,15,12,0.06)" strokeWidth={1} />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: '#6B6C66', fontFamily: 'var(--font-jetbrains)' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9C9C95', fontFamily: 'var(--font-jetbrains)' }} domain={[0, Math.ceil(maxCal * 1.15 / 100) * 100]} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload;
                        if (!d) return null;
                        const isUnder = d.netValue <= d.target;
                        return (
                          <div style={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', boxShadow: 'var(--ct-shadow-2)' }}>
                            <p style={{ fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>{formatDate(label)}</p>
                            <p><span style={{ color: 'var(--ct-ember)' }}>Eaten:</span> {d.eaten.toLocaleString()} kcal</p>
                            {d.burned > 0 && <p><span style={{ color: 'oklch(0.62 0.13 150)' }}>Exercise:</span> -{d.burned.toLocaleString()} kcal</p>}
                            <p style={{ fontWeight: 700, color: isUnder ? 'oklch(0.34 0.13 250)' : 'var(--ct-bad)', marginTop: 6 }}>
                              Net: {d.netValue.toLocaleString()} kcal {isUnder ? '✓' : '▲'}
                            </p>
                            <p style={{ color: 'var(--ct-ink-4)', fontSize: '11px', marginTop: 4 }}>Target: {d.target.toLocaleString()} kcal</p>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine y={today.target} stroke="oklch(0.58 0.17 245)" strokeDasharray="3 4" strokeWidth={1.2} opacity={0.6} />
                    <Bar dataKey="net" name="net" stackId="calories" fill="oklch(0.66 0.19 38)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="exercise" name="exercise" stackId="calories" fill="oklch(0.62 0.13 150)" opacity={0.7} radius={[3, 3, 0, 0]} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Scatter dataKey="netValue" name="Net" fill="oklch(0.34 0.13 250)" shape={(props: any) => {
                      const isOver = props.payload.netValue > props.payload.target;
                      return <circle cx={props.cx} cy={props.cy} r={4} fill="#fff" stroke={isOver ? 'oklch(0.62 0.20 25)' : 'oklch(0.34 0.13 250)'} strokeWidth={2} />;
                    }} />
                  </ComposedChart>
                </ResponsiveContainer>
              );
            })() : (
              <div className="flex items-center justify-center h-48" style={{ color: 'var(--ct-ink-3)' }}>No data for this period</div>
            )}
          </div>
          <div className="flex items-center justify-between px-6 py-3.5 text-xs" style={{ borderTop: '1px solid var(--ct-line)', color: 'var(--ct-ink-3)' }}>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'oklch(0.34 0.13 250)' }} /> Net (eaten - burned)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'oklch(0.66 0.19 38)' }} /> Eaten</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'oklch(0.62 0.13 150)' }} /> Exercise</span>
            </div>
            <span className="ct-mono">{stats.daysWithData} of {days > 0 ? days : '?'} logged</span>
          </div>
        </div>

        {/* Today's Macros */}
        <div className="ct-card">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
            <div>
              <div className="ct-kicker mb-1">Series 02</div>
              <h3 className="text-[18px] font-bold m-0" style={{ letterSpacing: '-0.015em' }}>Today&apos;s macros</h3>
            </div>
            <span className="ct-chip ct-chip--ember">{today.meals} meals</span>
          </div>
          <div className="grid gap-7 px-6 pb-6" style={{ gridTemplateColumns: '160px 1fr', alignItems: 'center' }}>
            {totalMacroG > 0 ? (
              <>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={macroData.slice(0, 3)} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {macroData.slice(0, 3).map((_, index) => (<Cell key={index} fill={MACRO_COLORS[index]} />))}
                    </Pie>
                    <text x="50%" y="46%" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ct-ink)" letterSpacing="-1">{today.calories.toLocaleString()}</text>
                    <text x="50%" y="62%" textAnchor="middle" fontSize="8" fill="var(--ct-ink-3)" letterSpacing="1" className="ct-mono">KCAL</text>
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {macroData.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between py-2.5" style={{ borderBottom: i < macroData.length - 1 ? '1px solid var(--ct-line)' : 'none' }}>
                      <div className="flex items-center gap-2.5">
                        <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: MACRO_COLORS[i] }} />
                        <span className="text-sm">{m.name}</span>
                        {m.pct > 0 && <span className="ct-mono text-xs" style={{ color: 'var(--ct-ink-3)' }}>{m.pct}%</span>}
                      </div>
                      <span className="ct-mono font-semibold text-sm">{Math.round(m.value)} g</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="col-span-2 flex items-center justify-center h-40" style={{ color: 'var(--ct-ink-3)' }}>No meals logged today</div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Weight Trend + Water */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Weight Trend */}
        <div className="ct-card">
          <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
            <div>
              <div className="ct-kicker mb-1">Series 03</div>
              <h3 className="text-[18px] font-bold m-0" style={{ letterSpacing: '-0.015em' }}>Weight trend</h3>
            </div>
            <span className="ct-chip" style={{ background: 'transparent', border: '1px solid var(--ct-line-2)', color: 'var(--ct-ink-3)' }}>
              {weightTrend.length} entries &middot; {days}D
            </span>
          </div>
          {weightTrend.length > 0 ? (
            <div className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weightTrend}>
                  <CartesianGrid stroke="rgba(14,15,12,0.06)" strokeWidth={1} />
                  <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: '#6B6C66' }} />
                  <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fontSize: 11, fill: '#9C9C95' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--ct-surface)', border: '1px solid var(--ct-line)', borderRadius: '14px', fontSize: '13px', boxShadow: 'var(--ct-shadow-2)' }}
                    labelFormatter={formatDate}
                    formatter={(value) => [`${value} kg`, 'Weight']}
                  />
                  {stats.targetWeight && (
                    <ReferenceLine y={stats.targetWeight} stroke="oklch(0.62 0.13 150)" strokeDasharray="5 5" label={{ value: `Goal: ${stats.targetWeight}`, fill: 'oklch(0.62 0.13 150)', fontSize: 11 }} />
                  )}
                  <Line type="monotone" dataKey="weight" stroke="oklch(0.55 0.18 305)" strokeWidth={2} dot={{ r: 3, fill: 'oklch(0.55 0.18 305)' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div
              className="mx-6 mb-6 rounded-2xl grid place-items-center h-[180px]"
              style={{
                background: 'var(--ct-surface-2)',
                border: '1.5px dashed var(--ct-line-2)',
              }}
            >
              <div className="text-center max-w-[300px]">
                <div className="ct-kicker mb-2">No data this period</div>
                <div className="text-sm" style={{ color: 'var(--ct-ink-2)' }}>
                  Log with <span className="ct-mono text-[11.5px] text-white px-1.5 py-0.5 rounded" style={{ background: 'var(--ct-ink)' }}>/weight</span> in Telegram
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Water Tracker */}
        <div className="ct-card px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="ct-kicker mb-1">Hydration</div>
              <h3 className="text-[18px] font-bold m-0" style={{ letterSpacing: '-0.015em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Droplets className="w-5 h-5" style={{ color: 'oklch(0.58 0.17 245)' }} />
                Water
              </h3>
            </div>
            <span className="ct-mono text-sm font-medium" style={{ color: 'var(--ct-ink-3)' }}>
              {((today.water_ml || 0) / 1000).toFixed(1)} / {((today.water_target_ml || 2500) / 1000).toFixed(1)}L
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-3.5 rounded-full overflow-hidden mb-5" style={{ background: 'rgba(14,15,12,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(((today.water_ml || 0) / (today.water_target_ml || 2500)) * 100, 100)}%`,
                background: 'oklch(0.58 0.17 245)',
              }}
            />
          </div>

          {/* Quick-add buttons */}
          <div className="grid grid-cols-3 gap-2">
            {[250, 500, 750].map((ml) => (
              <button
                key={ml}
                onClick={() => addWater(ml)}
                disabled={addingWater}
                className="ct-mono px-2 py-2.5 rounded-[10px] text-[12px] font-semibold transition-colors disabled:opacity-50"
                style={{
                  background: 'oklch(0.96 0.03 240)',
                  color: 'oklch(0.40 0.13 245)',
                  border: '1px solid transparent',
                }}
              >
                +{ml}ml
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Today Meal Strip */}
      <div className="ct-card">
        <div className="flex items-center justify-between px-6 pt-5 pb-3.5">
          <div>
            <div className="ct-kicker mb-1">Series 04 &middot; {dayName} breakdown</div>
            <h3 className="text-[18px] font-bold m-0" style={{ letterSpacing: '-0.015em' }}>
              Today — {today.meals} meals logged
            </h3>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 pb-6">
          {[
            { label: 'Calories', value: today.calories, unit: 'kcal', accent: true },
            { label: 'Protein', value: Math.round(today.protein), unit: 'g', accent: false },
            { label: 'Carbs', value: Math.round(today.carbs), unit: 'g', accent: false },
            { label: 'Fat', value: Math.round(today.fat), unit: 'g', accent: false },
          ].map((cell) => (
            <div
              key={cell.label}
              className="rounded-[14px] p-4"
              style={{
                background: cell.accent ? 'var(--ct-ember-soft)' : 'var(--ct-surface-2)',
                border: cell.accent ? 'none' : '1px solid var(--ct-line)',
              }}
            >
              <div className="ct-kicker mb-2">{cell.label}</div>
              <div className="text-2xl font-bold" style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: cell.accent ? 'var(--ct-ember-deep)' : 'var(--ct-ink)' }}>
                {cell.value.toLocaleString()}
                <span className="text-[13px] font-medium ml-0.5" style={{ color: 'var(--ct-ink-3)' }}>{cell.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
