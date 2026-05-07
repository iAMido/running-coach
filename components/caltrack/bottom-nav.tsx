'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Scale,
  Menu,
  Activity,
  Apple,
  LogOut,
  ChevronLeft,
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

const mainNavItems = [
  { href: '/caltrack', label: 'Overview', icon: LayoutDashboard },
  { href: '/caltrack/meals', label: 'Meals', icon: UtensilsCrossed },
  { href: '/caltrack/weight', label: 'Weight', icon: Scale },
];

const menuItems = [
  { href: '/caltrack/foods', label: 'Foods', icon: Apple },
  { href: '/coach', label: 'Running Coach', icon: Activity },
];

export function CaltrackBottomNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/95 backdrop-blur-lg border-t border-border safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 px-2 relative">
        {mainNavItems.map((item) => {
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
                'relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px]',
                isActive
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-muted-foreground active:scale-95'
              )}
            >
              {isActive && (
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-orange-500 rounded-full animate-pulse" />
              )}
              <div
                className={cn(
                  'relative p-1.5 rounded-xl transition-all duration-200',
                  isActive && 'bg-orange-500/10'
                )}
              >
                <Icon
                  className={cn(
                    'w-5 h-5 transition-transform duration-200',
                    isActive && 'text-orange-600 dark:text-orange-400 scale-110'
                  )}
                />
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium transition-all duration-200',
                  isActive && 'font-semibold'
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px] active:scale-95',
                menuOpen ? 'text-orange-600' : 'text-muted-foreground'
              )}
            >
              <div
                className={cn(
                  'relative p-1.5 rounded-xl transition-all duration-200',
                  menuOpen && 'bg-orange-500/10'
                )}
              >
                <Menu
                  className={cn(
                    'w-5 h-5 transition-transform duration-200',
                    menuOpen && 'rotate-90'
                  )}
                />
              </div>
              <span className="text-[10px] font-medium">More</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="h-auto max-h-[70vh] rounded-t-3xl px-4 pb-8 pt-0 border-t-0 [&>button]:hidden"
            style={{
              background: 'var(--nav-bg, rgba(255, 255, 255, 0.95))',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderTop:
                '1px solid var(--nav-border, rgba(255, 255, 255, 0.3))',
              boxShadow:
                'var(--nav-shadow, 0 8px 32px rgba(0, 0, 0, 0.12))',
            }}
          >
            <div
              className="flex justify-center pt-3 pb-2 cursor-pointer"
              onClick={() => setMenuOpen(false)}
            >
              <div className="w-10 h-1 rounded-full bg-muted-foreground/40" />
            </div>
            <SheetHeader className="pb-4 mb-4">
              <SheetTitle className="text-center text-base font-semibold text-foreground">
                Menu
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-2 pb-4">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-4 px-4 py-4 rounded-xl text-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.98]"
                  >
                    <div className="p-2 rounded-lg bg-background">
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
                <span className="font-medium text-base">
                  Back to Portfolio
                </span>
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
