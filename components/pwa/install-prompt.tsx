'use client';

import { useState, useEffect } from 'react';
import { Download, X, Share, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePWA } from '@/lib/hooks/use-pwa';

// Check if iOS
function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;
}

// Check if Safari
function isSafari(): boolean {
  if (typeof window === 'undefined') return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const { canInstall, isInstalled, promptInstall } = usePWA();
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    const wasDismissed = localStorage.getItem('pwa-install-dismissed');
    if (wasDismissed) {
      const dismissedTime = parseInt(wasDismissed, 10);
      // Show again after 7 days
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true);
        return;
      }
    }

    // Show iOS prompt for Safari users
    if (isIOS() && isSafari() && !isInstalled) {
      // Delay showing the prompt
      const timer = setTimeout(() => setShowIOSPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [isInstalled]);

  const handleDismiss = () => {
    setDismissed(true);
    setShowIOSPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  const handleInstall = async () => {
    const success = await promptInstall();
    if (success) {
      setDismissed(true);
    }
  };

  // Don't show if already installed or dismissed
  if (isInstalled || dismissed) return null;

  // iOS Safari prompt with instructions
  if (showIOSPrompt) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center p-4 animate-in fade-in duration-300">
        <Card className="w-full max-w-md mb-4 animate-in slide-in-from-bottom duration-300">
          <CardHeader className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-primary" />
              Install Running Coach
            </CardTitle>
            <CardDescription>
              Add to your home screen for the best experience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Share className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">1. Tap the Share button</p>
                  <p className="text-xs text-muted-foreground">At the bottom of your Safari browser</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Plus className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">2. Tap "Add to Home Screen"</p>
                  <p className="text-xs text-muted-foreground">Scroll down in the share menu</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Download className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">3. Tap "Add"</p>
                  <p className="text-xs text-muted-foreground">The app will appear on your home screen</p>
                </div>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={handleDismiss}>
              Maybe Later
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Android/Desktop install prompt
  if (canInstall) {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 animate-in slide-in-from-bottom duration-300">
        <Card className="shadow-lg border-primary/20">
          <CardHeader className="pb-2 relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-6 w-6"
              onClick={handleDismiss}
            >
              <X className="h-3 w-3" />
            </Button>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4 text-primary" />
              Install App
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              Install Running Coach for quick access and offline support.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleInstall} className="flex-1">
                Install
              </Button>
              <Button size="sm" variant="outline" onClick={handleDismiss}>
                Not Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

export function UpdatePrompt() {
  const { isUpdateAvailable, applyUpdate } = usePWA();

  if (!isUpdateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 animate-in slide-in-from-bottom duration-300">
      <Card className="shadow-lg border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Update Available
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground mb-3">
            A new version of Running Coach is available.
          </p>
          <Button size="sm" onClick={applyUpdate} className="w-full">
            Update Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function OfflineIndicator() {
  const { isOnline } = usePWA();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-amber-500 text-amber-950 text-center py-1 text-sm font-medium z-50">
      You're offline. Some features may be limited.
    </div>
  );
}
