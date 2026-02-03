'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { CoachSidebar } from '@/components/coach/sidebar';
import { BottomNav } from '@/components/coach/bottom-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { PWAProvider } from '@/components/pwa/pwa-provider';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-10 w-48 md:h-12 md:w-64" />
        <Skeleton className="h-4 w-64 md:w-96" />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-4 mt-8">
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
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
      <div className="min-h-screen bg-background">
        <CoachSidebar />
        <BottomNav />
        <main className="md:ml-64 transition-all duration-300">
          <div className="p-4 pb-24 md:p-6 md:pb-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </PWAProvider>
  );
}
