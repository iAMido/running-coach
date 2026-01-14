'use client'

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
import { ModeToggle } from '@/components/ui/mode-toggle'

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* CV Header with Navigation */}
      <header className="cv-header">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Ido Mosseri
          </h1>
          <div className="flex items-center gap-4">
            <CVNavigation />
            <ModeToggle />
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
