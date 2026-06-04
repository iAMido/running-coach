'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Scale,
  Apple,
  BookOpen,
  Bookmark,
  LogOut,
} from 'lucide-react';
import { signOut } from 'next-auth/react';

const navItems = [
  { href: '/caltrack', label: 'Overview', icon: LayoutDashboard },
  { href: '/caltrack/meals', label: 'Meals', icon: UtensilsCrossed },
  { href: '/caltrack/templates', label: 'Templates', icon: Bookmark },
  { href: '/caltrack/weight', label: 'Weight', icon: Scale },
  { href: '/caltrack/foods', label: 'Foods', icon: Apple },
  { href: '/caltrack/coach', label: 'Dietitian', icon: BookOpen },
];

export function CaltrackBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 md:hidden flex items-center gap-1 overflow-x-auto safe-area-inset-bottom"
      style={{
        background: 'var(--ct-paper)',
        borderBottom: '1px solid var(--ct-line)',
        padding: '10px 14px',
        scrollbarWidth: 'none',
      }}
    >
      {/* Brand */}
      <div
        className="flex items-center gap-2 shrink-0 pr-3.5 mr-2"
        style={{ borderRight: '1px solid var(--ct-line)' }}
      >
        <div
          className="w-7 h-7 rounded-[7px] grid place-items-center text-white text-[11px] font-bold"
          style={{ background: 'var(--ct-ember)' }}
        >
          CT
        </div>
        <span className="font-bold text-sm" style={{ color: 'var(--ct-ink)' }}>CalTrack</span>
      </div>

      {/* Nav pills */}
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === '/caltrack'
            ? pathname === '/caltrack'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors',
            )}
            style={{
              background: isActive ? 'var(--ct-ink)' : 'transparent',
              color: isActive ? '#fff' : 'var(--ct-ink-2)',
            }}
          >
            <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? '#fff' : 'var(--ct-ink-3)' }} />
            {item.label}
          </Link>
        );
      })}

      {/* Sign out */}
      <div className="shrink-0 ml-2 pl-2" style={{ borderLeft: '1px solid var(--ct-line)' }}>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium whitespace-nowrap"
          style={{ color: 'var(--ct-ink-3)' }}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}
