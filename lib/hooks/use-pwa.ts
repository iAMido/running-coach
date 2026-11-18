'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

// Browser state read through useSyncExternalStore rather than copied into
// React state from an effect (which renders twice and trips react-hooks lint).
const STANDALONE_QUERY = '(display-mode: standalone)';
function subscribeStandalone(onChange: () => void) {
  const mq = window.matchMedia(STANDALONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function isStandalone(): boolean {
  return window.matchMedia(STANDALONE_QUERY).matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAStatus {
  /** Set by the 'appinstalled' event; display-mode covers an app opened installed. */
  installedNow: boolean;
  isInstallable: boolean;
  isUpdateAvailable: boolean;
}

export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<PWAStatus>({
    installedNow: false,
    isInstallable: false,
    isUpdateAvailable: false,
  });
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const isInstalled = standalone || status.installedNow;

  // Capture install prompt
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setStatus(prev => ({ ...prev, isInstallable: true }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  // Handle app installed
  useEffect(() => {
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setStatus(prev => ({ ...prev, installedNow: true, isInstallable: false }));
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service Worker registered:', registration.scope);

          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  setStatus(prev => ({ ...prev, isUpdateAvailable: true }));
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('[PWA] Service Worker registration failed:', error);
        });

      // Handle controller change (update applied)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }, []);

  // Prompt install
  const promptInstall = useCallback(async () => {
    if (!installPrompt) return false;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === 'accepted') {
        setInstallPrompt(null);
        setStatus(prev => ({ ...prev, isInstallable: false }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PWA] Install prompt error:', error);
      return false;
    }
  }, [installPrompt]);

  // Apply update
  const applyUpdate = useCallback(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }
  }, []);

  return {
    isInstalled,
    isInstallable: status.isInstallable,
    isOnline,
    isUpdateAvailable: status.isUpdateAvailable,
    promptInstall,
    applyUpdate,
    canInstall: status.isInstallable && !isInstalled,
  };
}
