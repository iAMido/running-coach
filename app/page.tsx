'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { CVNavigation } from '@/components/cv/cv-navigation'
import { CVHero } from '@/components/cv/cv-hero'
import { CVAbout } from '@/components/cv/cv-about'
import { CVSkills } from '@/components/cv/cv-skills'
import { CVExperience } from '@/components/cv/cv-experience'
import { CVEducation } from '@/components/cv/cv-education'
import { CVContact } from '@/components/cv/cv-contact'
import { CVSidebar } from '@/components/cv/cv-sidebar'
import { Footer } from '@/components/layout/footer'
import { ScrollToTop } from '@/components/ui/scroll-to-top'
import { Button } from '@/components/ui/button'
import { LogIn, User } from 'lucide-react'

export default function Home() {
  const { data: session } = useSession()

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* CV Header with Navigation */}
      <header className="cv-header">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">
            Ido Mosseri
          </h1>
          <div className="flex items-center gap-4">
            <CVNavigation />
            {session ? (
              <div className="flex items-center gap-2">
                <Link href="/coach" className="text-sm font-medium text-[#2563EB] hover:underline hidden sm:block">
                  Coach
                </Link>
                <button
                  onClick={() => signOut()}
                  className="w-8 h-8 rounded-full overflow-hidden border-2 border-[#2563EB]/30 hover:border-[#2563EB]/60 transition-colors"
                >
                  {session.user?.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name || 'User'}
                      width={32}
                      height={32}
                    />
                  ) : (
                    <div className="w-full h-full bg-[#2563EB] flex items-center justify-center">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => signIn('google', { callbackUrl: '/coach' })}
                className="gap-2"
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Sign In</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* CV Content */}
      <div className="cv-content py-8 md:py-12">
        <div className="cv-layout">
          {/* Main Content Column */}
          <div className="space-y-0">
            <CVHero />
            <CVAbout />
            <CVSkills />
            <CVExperience />
            <CVEducation />
            <CVContact />
          </div>

          {/* Sidebar Column (Desktop Only) */}
          <CVSidebar />
        </div>
      </div>

      <Footer />
      <ScrollToTop />
    </main>
  )
}
