'use client';

/**
 * Pull recent activity from intervals.icu when the athlete opens the app.
 *
 * ## Why this exists instead of a webhook
 *
 * The webhook was the obvious design and it is not available: `ACTIVITY_UPLOADED`
 * is offered only to registered OAuth applications, and this app authenticates
 * with an API key. See docs/intervals-icu-implementation-spec.md Phase 5.
 *
 * This gets the part of the payoff that was actually wanted. The morning-after
 * coach note and the readiness verdict are read by opening the app, so the
 * latency that costs anything is the gap between a run landing on intervals.icu
 * and the athlete looking — not the gap until the next cron. A run uploaded at
 * 06:40 is on the dashboard seconds after the app opens at 07:15, instead of
 * waiting for 15:00 UTC.
 *
 * ## Never blocks the page
 *
 * Fired after paint and deliberately not awaited: the dashboard renders from
 * the database exactly as before, and refreshes only if the sync actually did
 * something. intervals.icu being slow or down can therefore never delay a page
 * load or surface as an error the athlete has to read.
 *
 * The debounce is enforced on the SERVER (`ifStaleMinutes`), not here. A client
 * check would be per-tab, and two tabs is precisely the case that matters.
 */

import { useEffect, useRef } from 'react';

/** Kept in step with AUTO_SYNC_STALE_MINUTES; the server is the authority. */
const STALE_MINUTES = 30;

export function useSyncOnOpen(onSynced: () => void) {
  // Survives React StrictMode's double-mount in development. The server-side
  // compare-and-swap is the real guard; this just avoids the pointless request.
  const fired = useRef(false);
  const callback = useRef(onSynced);
  callback.current = onSynced;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    void (async () => {
      try {
        const response = await fetch('/api/intervals/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ifStaleMinutes: STALE_MINUTES }),
        });
        if (!response.ok) return;
        const data = await response.json();

        // Refresh whenever a sync actually ran. Not gated on newRunsCount:
        // wellness is re-pulled over 30 days and intervals.icu recomputes
        // ctl/atl retroactively, so the readiness verdict can change on a sync
        // that imported no runs at all. At most one refresh per debounce
        // window, so the cost of being generous here is nil.
        if (data?.success && data.skipped === false) callback.current();
      } catch {
        // Background best-effort. The crons remain the unattended backstop.
      }
    })();
  }, []);
}
