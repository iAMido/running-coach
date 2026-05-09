'use client';

import { cn } from '@/lib/utils';
import { Calendar } from 'lucide-react';
import { useState } from 'react';

const presets = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

interface DateRangePickerProps {
  selectedDays: number;
  onChange: (days: number) => void;
  customRange?: { from: string; to: string };
  onCustomRange?: (from: string, to: string) => void;
}

export function DateRangePicker({
  selectedDays,
  onChange,
  customRange,
  onCustomRange,
}: DateRangePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [from, setFrom] = useState(customRange?.from || '');
  const [to, setTo] = useState(customRange?.to || '');
  const isCustomActive = selectedDays === -1;

  const handleApply = () => {
    if (from && to && onCustomRange) {
      onCustomRange(from, to);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div
        className="inline-flex gap-[1px] rounded-full p-[3px]"
        style={{
          background: 'var(--ct-surface)',
          border: '1px solid var(--ct-line)',
          boxShadow: 'var(--ct-shadow-1)',
        }}
      >
        {presets.map((preset) => {
          const isOn = selectedDays === preset.days && !isCustomActive;
          return (
            <button
              key={preset.days}
              onClick={() => {
                onChange(preset.days);
                setShowCustom(false);
              }}
              className={cn(
                'ct-mono px-[13px] py-[7px] rounded-full text-[11px] font-medium border-0 transition-colors',
              )}
              style={{
                background: isOn ? 'var(--ct-ink)' : 'transparent',
                color: isOn ? '#fff' : 'var(--ct-ink-3)',
                letterSpacing: '0.06em',
              }}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="px-[10px] py-[7px] rounded-full border-0 transition-colors"
          style={{
            background: isCustomActive ? 'var(--ct-ink)' : 'transparent',
            color: isCustomActive ? '#fff' : 'var(--ct-ink-3)',
          }}
          title="Custom date range"
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>
      {showCustom && (
        <div
          className="flex items-center gap-2 rounded-xl p-2"
          style={{
            background: 'var(--ct-surface)',
            border: '1px solid var(--ct-line)',
            boxShadow: 'var(--ct-shadow-1)',
          }}
        >
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border ct-mono"
            style={{ borderColor: 'var(--ct-line)', background: 'var(--ct-surface-2)' }}
          />
          <span className="text-sm" style={{ color: 'var(--ct-ink-3)' }}>to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border ct-mono"
            style={{ borderColor: 'var(--ct-line)', background: 'var(--ct-surface-2)' }}
          />
          <button
            onClick={handleApply}
            disabled={!from || !to}
            className="px-3 py-1 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors"
            style={{ background: 'var(--ct-ember)' }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
