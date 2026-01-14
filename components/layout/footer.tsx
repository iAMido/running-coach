'use client';

import Link from 'next/link';
import { Github, Linkedin, Twitter, Mail } from 'lucide-react';

const footerLinks = [
  { href: '/#about', label: 'About' },
  { href: '/#skills', label: 'Skills' },
  { href: '/#experience', label: 'Experience' },
  { href: '/#contact', label: 'Contact' },
];

const socialLinks = [
  { href: 'https://github.com/iAMido', icon: Github, label: 'GitHub' },
  { href: 'https://www.linkedin.com/in/idomosseri/', icon: Linkedin, label: 'LinkedIn' },
  { href: 'https://twitter.com/idomosseri', icon: Twitter, label: 'Twitter' },
  { href: 'mailto:idomosseri@gmail.com', icon: Mail, label: 'Email' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer id="contact" className="py-12 px-6 bg-slate-900 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col items-center gap-8">
          {/* Logo and Tagline */}
          <div className="flex flex-col items-center gap-3">
            <Link href="/" className="text-xl font-semibold text-white hover:text-blue-400 transition-colors">
              Ido Mosseri
            </Link>
            <p className="text-white/50 text-sm">Technical SEO Lead</p>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-8">
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-white/60 hover:text-blue-400 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Social Links */}
          <div className="flex items-center gap-5">
            {socialLinks.map((social) => {
              const IconComponent = social.icon;
              return (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/60 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                  aria-label={social.label}
                >
                  <IconComponent className="w-5 h-5" />
                </a>
              );
            })}
          </div>

          {/* Copyright */}
          <div className="pt-4 border-t border-white/10 w-full text-center">
            <p className="text-sm text-white/40">
              &copy; {currentYear} Ido Mosseri. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
