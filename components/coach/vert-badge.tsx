'use client';

import { Mountain } from 'lucide-react';
import { climbCategory, climbCategoryIsUnprecedented, vertPerKm } from '@/lib/utils/elevation';

/**
 * Climb on a run row.
 *
 * Two rules it exists to hold, both of which a later "tidy-up" would break:
 *
 * 1. **A missing reading renders as missing, not as flat.** Elevation exists on
 *    a minority of this athlete's rows, so the common case for older runs is no
 *    data. Rendering nothing would make an unmeasured run indistinguishable
 *    from a genuinely flat one — the exact conflation that put 204 impossible
 *    Z6 readings into this database. `showAbsent` makes the absence visible
 *    wherever the row has space for it.
 * 2. **Gradient, not total.** 600 m over 60 km is flat running; the same 600 m
 *    over 10 km is the steepest session he has ever run. The m/km figure is
 *    what the badge leads with once distance is known.
 */
export function VertBadge({
  gainM,
  distanceKm,
  showAbsent = false,
  className = '',
}: {
  gainM?: number | null;
  distanceKm?: number | null;
  /** Render an explicit "no elevation" marker instead of nothing. */
  showAbsent?: boolean;
  className?: string;
}) {
  if (typeof gainM !== 'number') {
    if (!showAbsent) return null;
    return (
      <span
        className={`rc-mono text-[10px] uppercase ${className}`}
        style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}
        title="No elevation recorded for this run — not the same as flat terrain."
      >
        no elev
      </span>
    );
  }

  const vpk = vertPerKm(gainM, distanceKm);
  const band = climbCategory(vpk);
  const unprecedented = climbCategoryIsUnprecedented(band);

  return (
    <span
      className={`inline-flex items-center gap-1 rc-mono text-[11px] ${className}`}
      style={{ color: unprecedented ? 'oklch(0.45 0.16 145)' : 'var(--rc-ink-3)' }}
      title={
        vpk === null
          ? `${Math.round(gainM)} m climbed`
          : `${Math.round(gainM)} m climbed · ${vpk.toFixed(1)} m/km · ${band}` +
            (unprecedented ? ' — steeper than anything else in your history' : '')
      }
    >
      <Mountain className="w-3 h-3" style={{ color: 'var(--rc-ink-4)' }} />
      {Math.round(gainM)}m
      {vpk !== null && (
        <span style={{ color: 'var(--rc-ink-4)' }}>· {vpk.toFixed(0)} m/km</span>
      )}
    </span>
  );
}
