'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ClipboardList,
  Calendar,
  Target,
  MessageSquare,
  Dumbbell,
  RefreshCw,
  Settings,
  ChevronLeft,
  LogOut,
  UtensilsCrossed,
} from 'lucide-react';
import { signOut } from 'next-auth/react';

const navItems = [
  { href: '/coach', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/coach/log', label: 'Log Runs', icon: ClipboardList },
  { href: '/coach/review', label: 'Weekly Review', icon: Calendar },
  { href: '/coach/plan', label: 'Training Plan', icon: Target },
  { href: '/coach/ask', label: 'Ask Coach', icon: MessageSquare },
  { href: '/coach/grocky', label: 'Grocky', icon: Dumbbell },
  { href: '/coach/strava', label: 'Sync Strava', icon: RefreshCw },
  { href: '/coach/settings', label: 'Settings', icon: Settings },
];

export function CoachSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen w-[248px] z-40',
        'hidden md:flex flex-col',
      )}
      style={{
        background: 'var(--rc-paper)',
        borderRight: '1px solid var(--rc-line)',
        padding: '22px 18px',
        gap: '6px',
      }}
    >
      {/* Brand */}
      <div
        className="flex items-center gap-3 px-2 pb-[18px] mb-3.5"
        style={{ borderBottom: '1px solid var(--rc-line)' }}
      >
        <div
          className="w-8 h-8 rounded-[9px] grid place-items-center text-white text-[13px] font-bold"
          style={{
            background: 'var(--rc-blue)',
            letterSpacing: '-0.02em',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 0 rgba(0,0,0,0.06)',
          }}
        >
          RC
        </div>
        <div>
          <div className="font-bold text-[15.5px]" style={{ letterSpacing: '-0.02em', color: 'var(--rc-ink)' }}>
            RunCoach
          </div>
          <div
            className="rc-mono text-[9.5px] font-normal uppercase"
            style={{ color: 'var(--rc-ink-3)', letterSpacing: '0.04em', marginTop: '2px' }}
          >
            v2 &middot; TRAINING
          </div>
        </div>
      </div>

      {/* Section label */}
      <div
        className="rc-mono text-[9.5px] font-medium uppercase px-3 pt-3.5 pb-1.5"
        style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.1em' }}
      >
        Coaching
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-[2px]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-[11px] px-3 py-[9px] rounded-[10px] text-sm font-medium transition-colors',
              )}
              style={{
                color: isActive ? 'var(--rc-ink)' : 'var(--rc-ink-2)',
                background: isActive ? 'var(--rc-surface)' : 'transparent',
                boxShadow: isActive ? 'var(--rc-shadow-1)' : 'none',
              }}
            >
              {isActive && (
                <span
                  className="absolute -left-[18px] top-3 bottom-3 w-[3px] rounded-sm"
                  style={{ background: 'var(--rc-blue)' }}
                />
              )}
              <Icon
                className="w-4 h-4 shrink-0"
                style={{ color: isActive ? 'var(--rc-blue)' : 'var(--rc-ink-3)' }}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="mt-auto pt-3.5 flex flex-col gap-0.5"
        style={{ borderTop: '1px solid var(--rc-line)' }}
      >
        <Link
          href="/caltrack"
          className="flex items-center gap-[11px] px-3 py-[9px] rounded-[10px] text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--rc-ink-3)' }}
        >
          <UtensilsCrossed className="w-4 h-4 shrink-0" />
          Switch to CalTrack
        </Link>
        <Link
          href="/"
          className="flex items-center gap-[11px] px-3 py-[9px] rounded-[10px] text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--rc-ink-3)' }}
        >
          <ChevronLeft className="w-4 h-4 shrink-0" />
          Back to Portfolio
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="w-full flex items-center gap-[11px] px-3 py-[9px] rounded-[10px] text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--rc-ink-3)' }}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
