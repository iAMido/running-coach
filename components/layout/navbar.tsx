'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User, LogOut, Settings, Sun, Moon, Menu, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const navLinks = [
  { href: '/#about', label: 'About' },
  { href: '/#skills', label: 'Skills' },
  { href: '/#experience', label: 'Experience' },
  { href: '/blog', label: 'Blog' },
  { href: '/#contact', label: 'Contact' },
];

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
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogoClick = () => {
    if (pathname === '/') {
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } else {
      router.push('/');
    }
    setMobileMenuOpen(false);
  };

  const handleLinkClick = () => {
    setMobileMenuOpen(false);
  };

  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl">
      <nav
        className="rounded-2xl md:rounded-full px-4 md:px-6 py-3 flex items-center justify-between"
        style={{
          background: 'var(--nav-bg, rgba(255, 255, 255, 0.7))',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--nav-border, rgba(255, 255, 255, 0.3))',
          boxShadow: 'var(--nav-shadow, 0 8px 32px rgba(0, 0, 0, 0.08))',
        }}
      >
        {/* Logo */}
        <button onClick={handleLogoClick} className="flex items-center gap-2 shrink-0 cursor-pointer">
          <Image
            src="/round-avatar.svg"
            alt="Ido Mosseri"
            width={24}
            height={24}
            className="rounded-full md:w-7 md:h-7"
          />
          <span className="text-base md:text-lg font-semibold text-foreground tracking-tight">
            Ido Mosseri
          </span>
        </button>

        {/* Desktop Navigation Links */}
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

        {/* Right Side */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <ThemeToggle />

          {/* User Avatar - Desktop */}
          <div className="hidden md:block">
            {session?.user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative rounded-full ring-2 ring-transparent hover:ring-[#2563EB]/50 transition-all duration-200">
                    <Avatar className="w-9 h-9 border-2 border-[#2563EB]/30">
                      <AvatarImage src={session.user.image || undefined} alt={session.user.name || 'User'} />
                      <AvatarFallback className="bg-gradient-to-br from-[#2563EB] to-[#10B981] text-white text-sm font-medium">
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
              <Avatar className="w-9 h-9 border-2 border-[#2563EB]/30 cursor-pointer hover:border-[#2563EB]/60 transition-colors" onClick={() => signIn('google')}>
                <AvatarFallback className="bg-gradient-to-br from-[#2563EB] to-[#10B981] text-white text-sm font-medium">
                  IM
                </AvatarFallback>
              </Avatar>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-foreground/70" />
            ) : (
              <Menu className="w-5 h-5 text-foreground/70" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div
          className="md:hidden mt-2 rounded-2xl p-4 space-y-1"
          style={{
            background: 'var(--nav-bg, rgba(255, 255, 255, 0.95))',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--nav-border, rgba(255, 255, 255, 0.3))',
            boxShadow: 'var(--nav-shadow, 0 8px 32px rgba(0, 0, 0, 0.12))',
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={handleLinkClick}
              className="block px-4 py-3 rounded-xl text-foreground/80 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors font-medium"
            >
              {link.label}
            </Link>
          ))}

          {/* Mobile User Section */}
          <div className="pt-3 mt-3 border-t border-black/5 dark:border-white/10">
            {session?.user ? (
              <div className="space-y-1">
                <div className="flex items-center gap-3 px-4 py-2">
                  <Avatar className="w-8 h-8 border-2 border-[#2563EB]/30">
                    <AvatarImage src={session.user.image || undefined} alt={session.user.name || 'User'} />
                    <AvatarFallback className="bg-gradient-to-br from-[#2563EB] to-[#10B981] text-white text-xs font-medium">
                      {session.user.name?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{session.user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                  </div>
                </div>
                <Link
                  href="/profile"
                  onClick={handleLinkClick}
                  className="block px-4 py-3 rounded-xl text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <User className="w-4 h-4 inline mr-2" />
                  Profile
                </Link>
                <button
                  onClick={() => {
                    signOut();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-4 h-4 inline mr-2" />
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  signIn('google');
                  setMobileMenuOpen(false);
                }}
                className="w-full px-4 py-3 rounded-xl bg-[#2563EB] text-white font-medium hover:bg-[#2563EB]/90 transition-colors"
              >
                Sign In with Google
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
