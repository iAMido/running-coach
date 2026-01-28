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
import { Target, Dumbbell, RefreshCw, Settings, LogOut, ChevronLeft } from 'lucide-react';

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
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/95 backdrop-blur-lg border-t border-border safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 px-2 relative">
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px]',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground active:scale-95'
              )}
            >
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full animate-pulse" />
              )}

              {/* Icon with background on active */}
              <div className={cn(
                'relative p-1.5 rounded-xl transition-all duration-200',
                isActive && 'bg-primary/10'
              )}>
                <Icon className={cn(
                  'w-5 h-5 transition-transform duration-200',
                  isActive && 'text-primary scale-110'
                )} />
              </div>

              <span className={cn(
                'text-[10px] font-medium transition-all duration-200',
                isActive && 'font-semibold'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Menu Button */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px] active:scale-95',
                menuOpen ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <div className={cn(
                'relative p-1.5 rounded-xl transition-all duration-200',
                menuOpen && 'bg-primary/10'
              )}>
                <Menu className={cn(
                  'w-5 h-5 transition-transform duration-200',
                  menuOpen && 'rotate-90'
                )} />
              </div>
              <span className="text-[10px] font-medium">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-3xl px-4 pb-8 pt-0 border-t-0 [&>button]:hidden"
            style={{
              background: 'var(--nav-bg, rgba(255, 255, 255, 0.95))',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderTop: '1px solid var(--nav-border, rgba(255, 255, 255, 0.3))',
              boxShadow: 'var(--nav-shadow, 0 8px 32px rgba(0, 0, 0, 0.12))',
            }}
          >
            {/* Drag handle indicator */}
            <div className="flex justify-center pt-3 pb-2 cursor-pointer" onClick={() => setMenuOpen(false)}>
              <div className="w-10 h-1 rounded-full bg-muted-foreground/40" />
            </div>
            <SheetHeader className="pb-4 mb-4">
              <SheetTitle className="text-center text-base font-semibold text-foreground">Menu</SheetTitle>
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
                    className={cn(
                      'flex items-center gap-4 px-4 py-4 rounded-xl transition-all active:scale-[0.98]',
                      isActive
                        ? 'bg-primary/15 text-primary'
                        : 'text-foreground bg-muted/50 hover:bg-muted'
                    )}
                  >
                    <div className={cn(
                      'p-2 rounded-lg',
                      isActive ? 'bg-primary/20' : 'bg-background'
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-medium text-base">{item.label}</span>
                  </Link>
                );
              })}

              <div className="border-t border-border my-4" />

              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-4 px-4 py-4 rounded-xl text-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.98]"
              >
                <div className="p-2 rounded-lg bg-background">
                  <ChevronLeft className="w-5 h-5" />
                </div>
                <span className="font-medium text-base">Back to Portfolio</span>
              </Link>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  signOut({ callbackUrl: '/' });
                }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-[0.98]"
              >
                <div className="p-2 rounded-lg bg-red-500/10">
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
