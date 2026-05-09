'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ClipboardList,
  Calendar,
  MessageSquare,
  Menu,
} from 'lucide-react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { signOut } from 'next-auth/react';
import { Target, Dumbbell, RefreshCw, Settings, LogOut, ChevronLeft, UtensilsCrossed } from 'lucide-react';

const mainNavItems = [
  { href: '/coach', label: 'Home', icon: LayoutDashboard },
  { href: '/coach/log', label: 'Log', icon: ClipboardList },
  { href: '/coach/review', label: 'Review', icon: Calendar },
  { href: '/coach/ask', label: 'Coach', icon: MessageSquare },
];

const menuItems = [
  { href: '/coach/plan', label: 'Training Plan', icon: Target },
  { href: '/coach/grocky', label: 'Grocky', icon: Dumbbell },
  { href: '/coach/strava', label: 'Sync Strava', icon: RefreshCw },
  { href: '/coach/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden safe-area-inset-bottom"
      style={{
        background: 'var(--rc-paper)',
        borderTop: '1px solid var(--rc-line)',
        boxShadow: '0 -2px 10px rgba(14,15,12,0.04)',
      }}
    >
      <div className="flex items-center justify-around h-16 px-2 relative">
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px]"
            >
              {isActive && (
                <span
                  className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{ background: 'var(--rc-blue)' }}
                />
              )}

              <div className={cn(
                'relative p-1.5 rounded-xl transition-all duration-200',
              )}
              style={{
                background: isActive ? 'var(--rc-blue-soft)' : 'transparent',
              }}>
                <Icon
                  className="w-5 h-5 transition-transform duration-200"
                  style={{
                    color: isActive ? 'var(--rc-blue)' : 'var(--rc-ink-3)',
                    transform: isActive ? 'scale(1.1)' : 'scale(1)',
                  }}
                />
              </div>

              <span
                className="text-[10px] transition-all duration-200"
                style={{
                  color: isActive ? 'var(--rc-blue)' : 'var(--rc-ink-3)',
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Menu Button */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              className="relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px] active:scale-95"
            >
              <div
                className="relative p-1.5 rounded-xl transition-all duration-200"
                style={{
                  background: menuOpen ? 'var(--rc-blue-soft)' : 'transparent',
                }}
              >
                <Menu
                  className="w-5 h-5 transition-transform duration-200"
                  style={{
                    color: menuOpen ? 'var(--rc-blue)' : 'var(--rc-ink-3)',
                    transform: menuOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                />
              </div>
              <span
                className="text-[10px] font-medium"
                style={{ color: menuOpen ? 'var(--rc-blue)' : 'var(--rc-ink-3)' }}
              >
                More
              </span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="h-auto max-h-[70vh] rounded-t-3xl px-4 pb-8 pt-0 border-t-0 [&>button]:hidden"
            style={{
              background: 'var(--rc-paper)',
              borderTop: '1px solid var(--rc-line)',
              boxShadow: 'var(--rc-shadow-2)',
            }}
          >
            <div className="flex justify-center pt-3 pb-2 cursor-pointer" onClick={() => setMenuOpen(false)}>
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--rc-ink-5)' }} />
            </div>
            <SheetHeader className="pb-4 mb-4">
              <SheetTitle className="text-center text-base font-semibold" style={{ color: 'var(--rc-ink)' }}>Menu</SheetTitle>
            </SheetHeader>
            <div className="space-y-2 pb-4">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-4 px-4 py-4 rounded-xl transition-all active:scale-[0.98]"
                    style={{
                      background: isActive ? 'var(--rc-blue-soft)' : 'var(--rc-surface)',
                      color: isActive ? 'var(--rc-blue)' : 'var(--rc-ink)',
                      border: `1px solid ${isActive ? 'rgba(0,0,0,0.04)' : 'var(--rc-line)'}`,
                    }}
                  >
                    <div
                      className="p-2 rounded-lg"
                      style={{
                        background: isActive ? 'var(--rc-blue-soft)' : 'var(--rc-surface-2)',
                      }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-medium text-base">{item.label}</span>
                  </Link>
                );
              })}

              <div className="my-4" style={{ borderTop: '1px solid var(--rc-line)' }} />

              <Link
                href="/caltrack"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-4 px-4 py-4 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: 'var(--rc-surface)', color: 'var(--rc-ink-2)', border: '1px solid var(--rc-line)' }}
              >
                <div className="p-2 rounded-lg" style={{ background: 'var(--rc-surface-2)' }}>
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <span className="font-medium text-base">Switch to CalTrack</span>
              </Link>

              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-4 px-4 py-4 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: 'var(--rc-surface)', color: 'var(--rc-ink-2)', border: '1px solid var(--rc-line)' }}
              >
                <div className="p-2 rounded-lg" style={{ background: 'var(--rc-surface-2)' }}>
                  <ChevronLeft className="w-5 h-5" />
                </div>
                <span className="font-medium text-base">Back to Portfolio</span>
              </Link>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  signOut({ callbackUrl: '/' });
                }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: 'rgba(239,83,80,0.06)', color: 'var(--rc-bad)', border: '1px solid rgba(239,83,80,0.1)' }}
              >
                <div className="p-2 rounded-lg" style={{ background: 'rgba(239,83,80,0.08)' }}>
                  <LogOut className="w-5 h-5" />
                </div>
                <span className="font-medium text-base">Sign Out</span>
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
