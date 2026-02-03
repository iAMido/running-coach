'use client';

import { InstallPrompt, UpdatePrompt, OfflineIndicator } from './install-prompt';

export function PWAProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineIndicator />
      {children}
      <InstallPrompt />
      <UpdatePrompt />
    </>
  );
}
