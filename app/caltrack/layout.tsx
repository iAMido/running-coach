'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { CaltrackSidebar } from '@/components/caltrack/sidebar';
import { CaltrackBottomNav } from '@/components/caltrack/bottom-nav';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: '#F4F1EA' }}>
      <div className="space-y-4 max-w-6xl">
        <Skeleton className="h-10 w-48 md:h-12 md:w-64" />
        <Skeleton className="h-4 w-64 md:w-96" />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mt-8">
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
          <Skeleton className="h-28 md:h-32" />
        </div>
        <Skeleton className="h-64 mt-4" />
      </div>
    </div>
  );
}

export default function CaltrackLayout({
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
    <div className="caltrack-theme min-h-screen">
      <CaltrackSidebar />
      <CaltrackBottomNav />
      <main className="md:ml-[248px] transition-all duration-300">
        <div className="p-4 pt-[72px] md:pt-0 md:px-14 md:py-9 md:pb-20 lg:px-14 max-w-[1480px]">
          {children}
        </div>
      </main>
    </div>
  );
}
