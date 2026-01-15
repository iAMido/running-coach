'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Link2, Unlink, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function StravaSyncPage() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [daysBack, setDaysBack] = useState('7');
  const [syncResult, setSyncResult] = useState<{ success: boolean; count: number } | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/strava/disconnect');
      const data = await response.json();
      setConnected(data.connected || false);
    } catch (error) {
      console.error('Failed to check status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    window.location.href = '/api/strava/auth';
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/strava/disconnect', { method: 'POST' });
      if (response.ok) {
        setConnected(false);
        setSyncResult(null);
      }
    } catch (error) {
      console.error('Disconnect failed:', error);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: parseInt(daysBack) }),
      });

      const data = await response.json();

      if (response.ok) {
        setSyncResult({ success: true, count: data.newRunsCount || 0 });
      } else {
        setSyncResult({ success: false, count: 0 });
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncResult({ success: false, count: 0 });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sync Strava</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Strava account to sync your running activities.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Connection Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              Connection Status
            </CardTitle>
            <CardDescription>
              Connect your Strava account to automatically sync runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#FC4C02] flex items-center justify-center">
                      <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">Strava</p>
                      <p className="text-sm text-muted-foreground">
                        {connected ? 'Connected' : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={connected ? 'default' : 'secondary'}>
                    {connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>

                {connected ? (
                  <Button
                    variant="outline"
                    onClick={handleDisconnect}
                    className="w-full"
                    disabled={disconnecting}
                  >
                    <Unlink className="w-4 h-4 mr-2" />
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleConnect}
                    className="w-full bg-[#FC4C02] hover:bg-[#FC4C02]/90 text-white"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Connect with Strava
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Sync Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Sync Activities
            </CardTitle>
            <CardDescription>
              Fetch recent runs from Strava and add them to your database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <label className="text-sm font-medium">Days to Sync</label>
              <Select value={daysBack} onValueChange={setDaysBack}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 7, 14, 30, 60, 90].map((days) => (
                    <SelectItem key={days} value={days.toString()}>
                      Last {days} day{days > 1 ? 's' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleSync}
              disabled={!connected || syncing}
              className="w-full bg-gradient-to-r from-blue-500 to-green-500 text-white"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>

            {syncResult && (
              <Alert variant={syncResult.success ? 'default' : 'destructive'}>
                {syncResult.success ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {syncResult.success ? 'Sync Complete' : 'Sync Failed'}
                </AlertTitle>
                <AlertDescription>
                  {syncResult.success
                    ? `Synced ${syncResult.count} new run${syncResult.count !== 1 ? 's' : ''}.`
                    : 'There was an error syncing your runs. Please try again.'}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Manual Upload */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Manual Upload
            </CardTitle>
            <CardDescription>
              Upload FIT files exported from Garmin or other devices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">
                Drag and drop FIT files here, or click to browse.
              </p>
              <Button variant="outline">
                Browse Files
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Supports .fit files from Garmin, Wahoo, and other devices.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
