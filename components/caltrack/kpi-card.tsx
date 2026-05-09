'use client';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: 'orange' | 'blue' | 'green' | 'purple' | 'red';
  progress?: number; // 0-100
}

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  progress,
}: KpiCardProps) {
  return (
    <div className="ct-stat relative overflow-hidden">
      <div className="flex items-center justify-between mb-3.5">
        <span className="ct-kicker">{title}</span>
        <span
          className="w-[22px] h-[22px] rounded-[7px] grid place-items-center"
          style={{ background: 'var(--ct-ember-soft)', color: 'var(--ct-ember)' }}
        >
          <Icon className="w-3 h-3" />
        </span>
      </div>
      <div
        className="ct-mono text-[32px] font-bold leading-none"
        style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
      >
        {value}
      </div>
      {subtitle && (
        <div
          className="mt-2.5 text-xs flex items-center gap-2"
          style={{ color: 'var(--ct-ink-3)' }}
        >
          {trend && (
            <span
              className="font-semibold"
              style={{ color: trend.value <= 0 ? 'var(--ct-good)' : 'var(--ct-bad)' }}
            >
              {trend.value >= 0 ? '+' : ''}{trend.value}
            </span>
          )}
          {subtitle}
        </div>
      )}
      {typeof progress === 'number' && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex-1 h-[5px] rounded-full overflow-hidden"
            style={{ background: 'rgba(14,15,12,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(progress, 100)}%`,
                background: 'var(--ct-ember)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
