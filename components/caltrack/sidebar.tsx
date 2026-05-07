'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Scale,
  Apple,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Activity,
} from 'lucide-react';
import { useState } from 'react';
import { signOut } from 'next-auth/react';

const navItems = [
  { href: '/caltrack', label: 'Overview', icon: LayoutDashboard },
  { href: '/caltrack/meals', label: 'Meals', icon: UtensilsCrossed },
  { href: '/caltrack/weight', label: 'Weight', icon: Scale },
  { href: '/caltrack/foods', label: 'Foods', icon: Apple },
];

export function CaltrackSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-background border-r border-border transition-all duration-300 z-40',
        'hidden md:block',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-foreground">CalTrack</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'p-2 rounded-lg hover:bg-accent transition-colors',
            collapsed && 'mx-auto'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>

      <nav className="p-2 space-y-1">
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
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-orange-500/10 to-red-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={cn(
                  'w-5 h-5 shrink-0',
                  isActive && 'text-orange-600 dark:text-orange-400'
                )}
              />
              {!collapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-4 left-0 right-0 px-2 space-y-1">
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Sign Out' : undefined}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
        </button>
        <Link
          href="/coach"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Running Coach' : undefined}
        >
          <Activity className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Running Coach</span>}
        </Link>
        <Link
          href="/"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Back to Portfolio' : undefined}
        >
          <ChevronLeft className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Back to Portfolio</span>}
        </Link>
      </div>
    </aside>
  );
}
