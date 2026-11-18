import { describe, expect, test } from 'bun:test';
import { acquireSyncLock, withSyncLock, type LockBackend } from './sync-lock';

/** In-memory stand-in for runcoach.try_sync_lock / release_sync_lock. */
function memoryBackend(): LockBackend & { holder: string | null } {
  const state = {
    holder: null as string | null,
    async tryLock(_u: string, holder: string) {
      if (state.holder && state.holder !== holder) return false;
      state.holder = holder;
      return true;
    },
    async release(_u: string, holder: string) {
      if (state.holder === holder) state.holder = null;
    },
  };
  return state;
}

describe('sync lock', () => {
  test('a second caller is refused while the first holds it', async () => {
    const backend = memoryBackend();
    const a = await acquireSyncLock('u', { backend });
    const b = await acquireSyncLock('u', { backend });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
  });

  test('withSyncLock releases even when the sync throws', async () => {
    const backend = memoryBackend();
    await expect(withSyncLock('u', async () => { throw new Error('boom'); }, { backend })).rejects.toThrow('boom');
    expect(backend.holder).toBeNull();
  });

  test('two concurrent syncs never run at the same time', async () => {
    const backend = memoryBackend();
    let running = 0;
    let maxRunning = 0;
    const sync = () => withSyncLock('u', async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return 'done';
    }, { backend, waitMs: 500, pollMs: 5 });
    const results = await Promise.all([sync(), sync()]);
    expect(maxRunning).toBe(1);
    expect(results).toEqual(['done', 'done']);
  });

  test('without waiting, the busy caller gets null and does not run', async () => {
    const backend = memoryBackend();
    let ran = 0;
    const slow = withSyncLock('u', async () => { ran++; await new Promise((r) => setTimeout(r, 30)); }, { backend });
    const busy = await withSyncLock('u', async () => { ran++; }, { backend });
    await slow;
    expect(busy).toBeNull();
    expect(ran).toBe(1);
  });
});
