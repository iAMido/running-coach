'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ExternalLink, HeartPulse, ShieldCheck, Unlink } from 'lucide-react';

/**
 * Garmin Connect Personal API — connect, rotate and status.
 *
 * Read-only by Garmin's design: workouts still reach the watch through
 * intervals.icu. The key is shown by Garmin once, so the athlete also states
 * when it expires; the app warns 14 days ahead.
 */

interface GarminStatus {
  connected: boolean;
  keyExpiresAt: string | null;
  keyDaysLeft: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
  daysWithReadings7d: number;
  latestReadingDay: string | null;
}

// The key page lives under Garmin Connect web settings; its exact URL is not documented.
const GARMIN_KEY_PAGE = 'https://connect.garmin.com/';
const WARN_DAYS = 14;

function inOneYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD in the browser's own timezone (the athlete's). */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** [from, to] windows of at most 28 days, oldest first, ending today. 28 = body battery's range limit. */
function historyWindows(months: number): [string, string][] {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  const out: [string, string][] = [];
  for (let a = new Date(start); a <= end; ) {
    const b = new Date(a);
    b.setDate(b.getDate() + 27);
    out.push([localDay(a), localDay(b > end ? end : b)]);
    a = new Date(b);
    a.setDate(a.getDate() + 1);
  }
  return out;
}

interface ImportProgress {
  done: number;
  total: number;
  days: number;
  message: string | null;
  finished: boolean;
}

export function GarminConnectCard() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [expiresAt, setExpiresAt] = useState(inOneYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [importMonths, setImportMonths] = useState('12');
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/garmin/connect');
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/garmin/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), keyExpiresAt: expiresAt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not connect');
        return;
      }
      setApiKey('');
      setRotating(false);
      setStatus(data.status);
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  // One request per 28-day window, oldest first. Stopping part-way keeps every
  // window already imported; re-running simply re-syncs them.
  //
  // Garmin rate-limits a long import (a 429 about 400 calls in, with a
  // Retry-After of ~20 s). The response then carries `cooldownUntil`: wait for
  // it and retry the SAME window, since the rate-limited part (usually sleep)
  // was not written.
  const importHistory = async () => {
    const windows = historyWindows(Number(importMonths));
    const MAX_RETRIES_PER_WINDOW = 5;
    const MAX_WAIT_MS = 10 * 60_000;
    setBusy(true);
    let days = 0;
    setProgress({ done: 0, total: windows.length, days: 0, message: null, finished: false });
    try {
      for (let i = 0; i < windows.length; i++) {
        const [from, to] = windows[i];
        for (let attempt = 0; ; attempt++) {
          const res = await fetch('/api/garmin/backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || (data.skipped && data.skipped !== 'cooldown')) {
            setProgress({ done: i, total: windows.length, days, message: `Stopped at ${from}: ${data.error || data.skipped}`, finished: true });
            return;
          }
          const rateLimited = data.skipped === 'cooldown' || (data.errors ?? []).some((e: string) => e.includes('429'));
          if (!rateLimited) {
            days += data.daysUpserted ?? 0;
            break;
          }
          if (attempt >= MAX_RETRIES_PER_WINDOW) {
            setProgress({
              done: i, total: windows.length, days, finished: true,
              message: `Stopped at ${from}: Garmin kept rate-limiting. Run the import again later; finished months are kept.`,
            });
            return;
          }
          const untilMs = Date.parse(data.cooldownUntil ?? '');
          const waitMs = Math.min(MAX_WAIT_MS, Math.max(5_000, Number.isFinite(untilMs) ? untilMs - Date.now() + 2_000 : 60_000));
          setProgress({
            done: i, total: windows.length, days, finished: false,
            message: `Garmin asked for a pause — resuming in ${Math.ceil(waitMs / 1000)} s`,
          });
          await new Promise((r) => setTimeout(r, waitMs));
        }
        setProgress({ done: i + 1, total: windows.length, days, message: null, finished: false });
      }
      setProgress({ done: windows.length, total: windows.length, days, message: null, finished: true });
      await load();
    } catch {
      setProgress((p) => (p ? { ...p, message: 'Network error — re-run to continue', finished: true } : p));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch('/api/garmin/connect', { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);
  const daysLeft = status?.keyDaysLeft ?? null;
  const expiring = connected && daysLeft !== null && daysLeft <= WARN_DAYS;
  const showForm = !connected || rotating || (daysLeft !== null && daysLeft < 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5" />
          Garmin recovery data
        </CardTitle>
        <CardDescription>
          Body battery, stress, sleep stages and HRV status from Garmin&apos;s Personal API.
          Read-only: workouts still go to your watch through intervals.icu.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Garmin Connect</p>
                  <p className="text-sm text-muted-foreground">
                    {connected
                      ? `${status!.daysWithReadings7d}/7 recent days with readings${
                          status!.latestReadingDay ? ` · latest ${status!.latestReadingDay}` : ''
                        }`
                      : 'Not connected'}
                  </p>
                </div>
                <Badge variant={connected ? (expiring ? 'destructive' : 'default') : 'secondary'}>
                  {!connected ? 'Disconnected' : daysLeft !== null && daysLeft < 0 ? 'Key expired' : 'Connected'}
                </Badge>
              </div>

              {connected && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Key expires {status!.keyExpiresAt}
                    {daysLeft !== null && daysLeft >= 0 ? ` (in ${daysLeft} days)` : ''}
                  </p>
                  {status!.lastSuccessAt && <p>Last synced {new Date(status!.lastSuccessAt).toLocaleString()}</p>}
                </div>
              )}

              {expiring && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{daysLeft! < 0 ? 'Key expired' : 'Key expiring soon'}</AlertTitle>
                  <AlertDescription>
                    Create a new key in Garmin Connect and paste it below. Recovery data stops syncing when the key expires.
                  </AlertDescription>
                </Alert>
              )}

              {connected && status!.lastError && !expiring && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Last sync had a problem</AlertTitle>
                  <AlertDescription className="break-words">{status!.lastError}</AlertDescription>
                </Alert>
              )}

              {showForm ? (
                <div className="space-y-3">
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Read-only, stored encrypted</AlertTitle>
                    <AlertDescription>
                      The key can read your Garmin health data but cannot change anything. Garmin shows it once, so
                      paste it here straight away. Never paste it into a chat.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="garmin-key">Personal API key</label>
                    <Input
                      id="garmin-key"
                      type="password"
                      autoComplete="off"
                      placeholder="GCDC_…"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="garmin-expiry">Key expires on</label>
                    <Input id="garmin-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      The expiry you chose when creating the key (30, 90, 180 or 365 days). Garmin does not report it.
                    </p>
                  </div>

                  <a
                    href={GARMIN_KEY_PAGE}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Garmin Connect (web) → Personal API Key → Create Key
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Could not connect</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={connect} disabled={busy || apiKey.trim().length < 20} className="flex-1">
                      {busy ? 'Checking key and syncing…' : connected ? 'Replace key' : 'Test & connect'}
                    </Button>
                    {rotating && (
                      <Button variant="outline" onClick={() => setRotating(false)} disabled={busy}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Import history</p>
                  <p className="text-xs text-muted-foreground">
                    Fills older days so recovery can be compared against your own normal. About 35 seconds per month; keep this page open.
                  </p>
                  <div className="flex gap-2">
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={importMonths}
                      onChange={(e) => setImportMonths(e.target.value)}
                      disabled={busy}
                      aria-label="How far back"
                    >
                      <option value="3">Last 3 months</option>
                      <option value="6">Last 6 months</option>
                      <option value="12">Last year</option>
                      <option value="24">Last 2 years</option>
                    </select>
                    <Button variant="outline" onClick={importHistory} disabled={busy} className="flex-1">
                      {progress && !progress.finished ? `Importing ${progress.done}/${progress.total}…` : 'Import'}
                    </Button>
                  </div>
                  {progress?.message && !progress.finished && (
                    <p className="text-xs text-muted-foreground">{progress.message}</p>
                  )}
                  {progress?.finished && (
                    <p className="text-xs text-muted-foreground">
                      {progress.message ?? `Done: ${progress.days} days with Garmin data imported.`}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setRotating(true)} className="flex-1" disabled={busy}>
                    Replace key
                  </Button>
                  <Button variant="outline" onClick={disconnect} className="flex-1" disabled={busy}>
                    <Unlink className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
