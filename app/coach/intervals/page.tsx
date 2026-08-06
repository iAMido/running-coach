'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Link2, Unlink, CheckCircle, AlertCircle, Upload, FileUp, ExternalLink, ShieldAlert } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface UploadResult {
  success: boolean;
  uploaded: number;
  skipped: number;
  errors?: string[];
}

interface SyncResult {
  success: boolean;
  count: number;
  lapsBackfilled: number;
  wellnessDays: number;
  dateCorrected: number;
  errors?: string[];
  message?: string;
}

export default function IntervalsSyncPage() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [athleteIdInput, setAthleteIdInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [daysBack, setDaysBack] = useState('7');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/intervals/connect');
      const data = await response.json();
      setConnected(data.connected || false);
      setAthleteId(data.athleteId ?? null);
      setLastSyncAt(data.lastSyncAt ?? null);
    } catch (error) {
      console.error('Failed to check status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);

    try {
      const response = await fetch('/api/intervals/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim(), athleteId: athleteIdInput.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        // Clear the key from component state as soon as it is stored.
        setApiKeyInput('');
        setAthleteIdInput('');
        await checkStatus();
      } else {
        setConnectError(data.error || 'Could not connect.');
      }
    } catch {
      setConnectError('Network error while connecting.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/intervals/connect', { method: 'DELETE' });
      if (response.ok) {
        setConnected(false);
        setAthleteId(null);
        setLastSyncAt(null);
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
      const response = await fetch('/api/intervals/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: parseInt(daysBack) }),
      });

      const data = await response.json();

      if (response.ok) {
        setSyncResult({
          success: true,
          count: data.newRunsCount || 0,
          lapsBackfilled: data.lapsBackfilledCount || 0,
          wellnessDays: data.wellnessDaysUpserted || 0,
          dateCorrected: data.dateCorrected || 0,
          errors: data.errors,
        });
        await checkStatus();
      } else {
        setSyncResult({
          success: false, count: 0, lapsBackfilled: 0, wellnessDays: 0, dateCorrected: 0,
          message: data.error,
        });
      }
    } catch {
      setSyncResult({
        success: false, count: 0, lapsBackfilled: 0, wellnessDays: 0, dateCorrected: 0,
        message: 'Network error while syncing.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const fitFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.fit'));
    setSelectedFiles(prev => [...prev, ...fitFiles]);
    setUploadResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));

      const response = await fetch('/api/coach/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (response.ok) {
        setUploadResult({
          success: true,
          uploaded: data.uploaded || 0,
          skipped: data.skipped || 0,
          errors: data.errors,
        });
        setSelectedFiles([]);
      } else {
        setUploadResult({ success: false, uploaded: 0, skipped: 0, errors: [data.error || 'Upload failed'] });
      }
    } catch {
      setUploadResult({ success: false, uploaded: 0, skipped: 0, errors: ['Network error'] });
    } finally {
      setUploading(false);
    }
  };

  // The athlete id is optional — blank resolves to the key's own athlete.
  const canConnect = apiKeyInput.trim().length >= 8 && !connecting;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sync intervals.icu</h1>
        <p className="text-muted-foreground mt-1">
          Connect intervals.icu to sync runs and recovery data sourced from Garmin.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              Connection Status
            </CardTitle>
            <CardDescription>
              Your API key is stored encrypted and is never shown again after saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#1264A3] flex items-center justify-center">
                      <RefreshCw className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <p className="font-medium">intervals.icu</p>
                      <p className="text-sm text-muted-foreground">
                        {connected ? `Athlete ${athleteId}` : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={connected ? 'default' : 'secondary'}>
                    {connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>

                {connected ? (
                  <>
                    {lastSyncAt && (
                      <p className="text-sm text-muted-foreground">
                        Last synced {new Date(lastSyncAt).toLocaleString()}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      onClick={handleDisconnect}
                      className="w-full"
                      disabled={disconnecting}
                    >
                      <Unlink className="w-4 h-4 mr-2" />
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <Alert>
                      <ShieldAlert className="h-4 w-4" />
                      <AlertTitle>This key grants write access</AlertTitle>
                      <AlertDescription>
                        An intervals.icu API key can create and delete workouts on your
                        training calendar, not just read them. It is encrypted before
                        being stored.
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="icu-key">API Key</label>
                      <Input
                        id="icu-key"
                        type="password"
                        autoComplete="off"
                        placeholder="Your intervals.icu API key"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="icu-athlete">
                        Athlete ID <span className="font-normal text-muted-foreground">(optional)</span>
                      </label>
                      <Input
                        id="icu-athlete"
                        autoComplete="off"
                        placeholder="i665723 — or leave blank"
                        value={athleteIdInput}
                        onChange={(e) => setAthleteIdInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank and the key&apos;s own athlete is used. A missing
                        &quot;i&quot; prefix is the usual cause of a 403.
                      </p>
                    </div>

                    <a
                      href="https://intervals.icu/settings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      Find both under Settings → Developer Settings
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    {connectError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Could not connect</AlertTitle>
                        <AlertDescription>{connectError}</AlertDescription>
                      </Alert>
                    )}

                    <Button onClick={handleConnect} disabled={!canConnect} className="w-full">
                      <Link2 className="w-4 h-4 mr-2" />
                      {connecting ? 'Verifying...' : 'Connect'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Sync Activities
            </CardTitle>
            <CardDescription>
              Fetch recent runs and 30 days of recovery data.
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
                  {[1, 3, 7, 14, 30].map((days) => (
                    <SelectItem key={days} value={days.toString()}>
                      Last {days} day{days > 1 ? 's' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                For filling in history, use the backfill script rather than this — it
                reports what it would change before writing.
              </p>
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
                {syncResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <AlertTitle>{syncResult.success ? 'Sync Complete' : 'Sync Failed'}</AlertTitle>
                <AlertDescription>
                  {syncResult.success ? (
                    <span>
                      Synced {syncResult.count} new run{syncResult.count !== 1 ? 's' : ''}.
                      {syncResult.lapsBackfilled > 0 && ` Backfilled laps for ${syncResult.lapsBackfilled} existing run${syncResult.lapsBackfilled !== 1 ? 's' : ''}.`}
                      {syncResult.wellnessDays > 0 && ` Updated ${syncResult.wellnessDays} day${syncResult.wellnessDays !== 1 ? 's' : ''} of recovery data.`}
                    </span>
                  ) : (
                    syncResult.message || 'There was an error syncing your runs.'
                  )}

                  {syncResult.success && syncResult.dateCorrected > 0 && (
                    <p className="mt-2 font-medium">
                      Corrected {syncResult.dateCorrected} stored timestamp
                      {syncResult.dateCorrected !== 1 ? 's' : ''}. After the one-time
                      backfill this should always be zero — if it keeps happening,
                      something is competing for these rows.
                    </p>
                  )}

                  {syncResult.errors && syncResult.errors.length > 0 && (
                    <ul className="mt-1 text-xs list-disc list-inside">
                      {syncResult.errors.slice(0, 3).map((err, i) => <li key={i}>{err}</li>)}
                      {syncResult.errors.length > 3 && <li>...and {syncResult.errors.length - 3} more</li>}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Manual Upload — carried over unchanged */}
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
          <CardContent className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-muted hover:border-muted-foreground/50'
              }`}
            >
              <Upload className={`w-12 h-12 mx-auto mb-4 ${dragOver ? 'text-blue-500' : 'text-muted-foreground opacity-50'}`} />
              <p className="text-muted-foreground mb-2">
                {dragOver ? 'Drop files here...' : 'Drag and drop FIT files here, or click to browse.'}
              </p>
              <p className="text-xs text-muted-foreground">
                Supports .fit files from Garmin, Wahoo, and other devices.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".fit,.FIT"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="flex items-center gap-1 cursor-pointer hover:bg-destructive/20"
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                    >
                      <FileUp className="w-3 h-3" />
                      {file.name}
                      <span className="ml-1 text-muted-foreground">×</span>
                    </Badge>
                  ))}
                </div>
                <Button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="w-full bg-gradient-to-r from-blue-500 to-green-500 text-white"
                >
                  <Upload className={`w-4 h-4 mr-2 ${uploading ? 'animate-pulse' : ''}`} />
                  {uploading ? 'Uploading...' : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            )}

            {uploadResult && (
              <Alert variant={uploadResult.success ? 'default' : 'destructive'}>
                {uploadResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <AlertTitle>{uploadResult.success ? 'Upload Complete' : 'Upload Failed'}</AlertTitle>
                <AlertDescription>
                  {uploadResult.success ? (
                    <span>
                      Uploaded {uploadResult.uploaded} run{uploadResult.uploaded !== 1 ? 's' : ''}.
                      {uploadResult.skipped > 0 && ` Skipped ${uploadResult.skipped} duplicate${uploadResult.skipped !== 1 ? 's' : ''}.`}
                    </span>
                  ) : null}
                  {uploadResult.errors && uploadResult.errors.length > 0 && (
                    <ul className="mt-1 text-xs list-disc list-inside">
                      {uploadResult.errors.slice(0, 3).map((err, i) => <li key={i}>{err}</li>)}
                      {uploadResult.errors.length > 3 && <li>...and {uploadResult.errors.length - 3} more</li>}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
