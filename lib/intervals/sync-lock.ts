import { randomUUID } from 'crypto';
import { supabase } from '@/lib/db/supabase';

/**
 * One activity sync per athlete at a time (`runcoach.sync_locks`, migration
 * 20261118_sync_locks.sql).
 *
 * The cron, sync-on-open and "Sync now" all import runs. Two running together
 * could double a run: one in its Garmin step writes `garmin_<id>` while the
 * other, in its intervals.icu step, writes `icu_<id>` for the same activity —
 * different filenames, so the unique index cannot stop it, and the fuzzy
 * match only sees rows that are already committed.
 *
 * A lease that expires on its own, because Vercel can kill a function
 * mid-sync. 300 s = the platform's function limit.
 */
export const SYNC_LOCK_TTL_SECONDS = 300;

export type LockResult =
  | { acquired: true; holder: string }
  /** Another sync holds it. */
  | { acquired: false; holder: null };

/** Test seam: the two RPCs, so the wait loop is testable without a database. */
export interface LockBackend {
  tryLock(userId: string, holder: string, ttlSeconds: number): Promise<boolean>;
  release(userId: string, holder: string): Promise<void>;
}

const supabaseBackend: LockBackend = {
  async tryLock(userId, holder, ttlSeconds) {
    const { data, error } = await supabase.rpc('try_sync_lock', {
      p_user_id: userId, p_holder: holder, p_ttl_seconds: ttlSeconds,
    });
    // Fail OPEN: a missing function (migration not applied yet) or a database
    // hiccup must not stop the athlete's runs from syncing. That is exactly
    // the behaviour before the lock existed — loud, so it does not go unseen.
    if (error) {
      console.warn(`sync lock unavailable, syncing without it: ${error.message}`);
      return true;
    }
    return data === true;
  },
  async release(userId, holder) {
    const { error } = await supabase.rpc('release_sync_lock', { p_user_id: userId, p_holder: holder });
    // An unreleased lease expires on its own; never fail a finished sync over it.
    if (error) console.warn(`sync lock release failed (expires on its own): ${error.message}`);
  },
};

/**
 * Take the lock, waiting up to `waitMs` for a sync already running to finish.
 * `waitMs: 0` = try once (cron, sync-on-open: the other sync is doing the
 * same work). The manual button waits, so a tap during sync-on-open still
 * returns the fresh result instead of "busy".
 */
export async function acquireSyncLock(
  userId: string,
  opts: { waitMs?: number; pollMs?: number; backend?: LockBackend } = {},
): Promise<LockResult> {
  const backend = opts.backend ?? supabaseBackend;
  const pollMs = opts.pollMs ?? 2_000;
  const deadline = Date.now() + (opts.waitMs ?? 0);
  const holder = randomUUID();
  for (;;) {
    if (await backend.tryLock(userId, holder, SYNC_LOCK_TTL_SECONDS)) return { acquired: true, holder };
    if (Date.now() + pollMs > deadline) return { acquired: false, holder: null };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function releaseSyncLock(userId: string, lock: LockResult, backend: LockBackend = supabaseBackend): Promise<void> {
  if (lock.acquired) await backend.release(userId, lock.holder);
}

/** Run `fn` holding the lock; `null` when another sync held it throughout. */
export async function withSyncLock<T>(
  userId: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number; pollMs?: number; backend?: LockBackend } = {},
): Promise<T | null> {
  const lock = await acquireSyncLock(userId, opts);
  if (!lock.acquired) return null;
  try {
    return await fn();
  } finally {
    await releaseSyncLock(userId, lock, opts.backend);
  }
}
