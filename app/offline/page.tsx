'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function OfflinePage() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <WifiOff className="w-8 h-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">You're Offline</CardTitle>
          <CardDescription>
            It looks like you've lost your internet connection. Don't worry - your training data is saved locally.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Some features require an internet connection to work. Please check your connection and try again.
          </p>
          <Button onClick={handleRetry} className="w-full gap-2">
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
          <p className="text-xs text-muted-foreground">
            Tip: Your recent training plan and run history are cached for offline viewing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
