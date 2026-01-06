'use client';

import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User, LogOut, Settings, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const navLinks = [
  { href: '#about', label: 'About' },
  { href: '#projects', label: 'Projects' },
  { href: '#insights', label: 'AI & Dev' },
  { href: '#contact', label: 'Contact' },
];

function PhoenixLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="phoenixGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF4D8E" />
          <stop offset="50%" stopColor="#FF4D8E" />
          <stop offset="100%" stopColor="#FF9100" />
        </linearGradient>
      </defs>
      <path
        d="M50 10C35 10 25 25 25 40C25 50 30 58 38 63C30 68 25 78 25 88C35 85 45 78 50 68C55 78 65 85 75 88C75 78 70 68 62 63C70 58 75 50 75 40C75 25 65 10 50 10Z"
        fill="url(#phoenixGradient)"
      />
      <path
        d="M50 20C42 20 36 28 36 38C36 45 40 51 46 55C50 58 50 68 50 68C50 68 50 58 54 55C60 51 64 45 64 38C64 28 58 20 50 20Z"
        fill="white"
        fillOpacity="0.3"
      />
      <circle cx="44" cy="35" r="3" fill="white" />
      <circle cx="56" cy="35" r="3" fill="white" />
    </svg>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="w-9 h-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center">
        <Sun className="w-4 h-4 text-foreground/60" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="w-9 h-9 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 flex items-center justify-center transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        <Sun className="w-4 h-4 text-foreground/70 hover:text-foreground transition-colors" />
      ) : (
        <Moon className="w-4 h-4 text-foreground/70 hover:text-foreground transition-colors" />
      )}
    </button>
  );
}

export function Navbar() {
  const { data: session } = useSession();

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4">
      <nav
        className="rounded-full px-6 py-3 flex items-center justify-between"
        style={{
          background: 'var(--nav-bg, rgba(255, 255, 255, 0.7))',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--nav-border, rgba(255, 255, 255, 0.3))',
          boxShadow: 'var(--nav-shadow, 0 8px 32px rgba(0, 0, 0, 0.08))',
        }}
      >
        {/* Logo */}
        <button onClick={scrollToTop} className="flex items-center gap-2 shrink-0 cursor-pointer">
          <PhoenixLogo className="w-7 h-7" />
          <span className="text-lg font-semibold text-foreground tracking-tight">
            YUV.AI
          </span>
        </button>

        {/* Navigation Links - Center */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors duration-200"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right Side - Theme Toggle & User Avatar */}
        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative rounded-full ring-2 ring-transparent hover:ring-[#FF4D8E]/50 transition-all duration-200">
                  <Avatar className="w-9 h-9 border-2 border-[#FF4D8E]/30">
                    <AvatarImage src={session.user.image || undefined} alt={session.user.name || 'User'} />
                    <AvatarFallback className="bg-gradient-to-br from-[#FF4D8E] to-[#FF9100] text-white text-sm font-medium">
                      {session.user.name?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-panel-dark border-white/10">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-white">{session.user.name}</p>
                  <p className="text-xs text-white/60 truncate">{session.user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem asChild className="text-white/80 hover:text-white hover:bg-white/10 cursor-pointer">
                  <Link href="/profile">
                    <User className="w-4 h-4 mr-2" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="text-white/80 hover:text-white hover:bg-white/10 cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  onClick={() => signOut()}
                  className="text-red-400 hover:text-red-300 hover:bg-white/10 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Avatar className="w-9 h-9 border-2 border-[#FF4D8E]/30 cursor-pointer hover:border-[#FF4D8E]/60 transition-colors" onClick={() => signIn('google')}>
              <AvatarFallback className="bg-gradient-to-br from-[#FF4D8E] to-[#FF9100] text-white text-sm font-medium">
                YA
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </nav>
    </header>
  );
}
