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
      <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
        {presets.map((preset) => (
          <button
            key={preset.days}
            onClick={() => {
              onChange(preset.days);
              setShowCustom(false);
            }}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
              selectedDays === preset.days && !isCustomActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={cn(
            'px-2 py-1.5 rounded-md transition-all duration-200',
            isCustomActive
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title="Custom date range"
        >
          <Calendar className="w-4 h-4" />
        </button>
      </div>
      {showCustom && (
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg p-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 text-sm rounded-md border border-border bg-background"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 text-sm rounded-md border border-border bg-background"
          />
          <button
            onClick={handleApply}
            disabled={!from || !to}
            className="px-3 py-1 text-sm font-medium rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
