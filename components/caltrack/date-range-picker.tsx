'use client';

import { cn } from '@/lib/utils';

const presets = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

interface DateRangePickerProps {
  selectedDays: number;
  onChange: (days: number) => void;
}

export function DateRangePicker({
  selectedDays,
  onChange,
}: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
      {presets.map((preset) => (
        <button
          key={preset.days}
          onClick={() => onChange(preset.days)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
            selectedDays === preset.days
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
