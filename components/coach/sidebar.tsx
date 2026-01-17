'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
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
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/coach', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/coach/log', label: 'Log Runs', icon: ClipboardList },
  { href: '/coach/review', label: 'Weekly Review', icon: Calendar },
  { href: '/coach/plan', label: 'Training Plan', icon: Target },
  { href: '/coach/ask', label: 'Ask Coach', icon: MessageSquare },
  { href: '/coach/grocky', label: 'Grocky Balboa', icon: Dumbbell },
  { href: '/coach/strava', label: 'Sync Strava', icon: RefreshCw },
  { href: '/coach/settings', label: 'Settings', icon: Settings },
];

export function CoachSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-background border-r border-border transition-all duration-300 z-40',
        'hidden md:block', // Hide on mobile
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center">
              <Dumbbell className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-foreground">Coach</span>
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

      {/* Navigation */}
      <nav className="p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-blue-500/10 to-green-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={cn(
                  'w-5 h-5 shrink-0',
                  isActive && 'text-blue-600 dark:text-blue-400'
                )}
              />
              {!collapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
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
