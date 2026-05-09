'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { CoachSidebar } from '@/components/coach/sidebar';
import { BottomNav } from '@/components/coach/bottom-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { PWAProvider } from '@/components/pwa/pwa-provider';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: '#F4F1EA' }}>
      <div className="space-y-4 max-w-6xl">
        <Skeleton className="h-10 w-48 md:h-12 md:w-64" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <Skeleton className="h-4 w-64 md:w-96" style={{ background: 'rgba(14,15,12,0.06)' }} />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mt-8">
          <Skeleton className="h-28 md:h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
          <Skeleton className="h-28 md:h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
          <Skeleton className="h-28 md:h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
          <Skeleton className="h-28 md:h-32" style={{ background: 'rgba(14,15,12,0.06)' }} />
        </div>
      </div>
    </div>
  );
}

export default function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (!session) {
    redirect('/');
  }

  return (
    <PWAProvider>
      <div className="runcoach-theme min-h-screen">
        <CoachSidebar />
        <BottomNav />
        <main className="md:ml-[248px] transition-all duration-300">
          <div className="p-4 pb-24 md:px-14 md:py-9 md:pb-20 lg:px-14 max-w-[1480px]">
            {children}
          </div>
        </main>
      </div>
    </PWAProvider>
  );
}
