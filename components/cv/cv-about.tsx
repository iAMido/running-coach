"use client"

import { cvData } from "@/lib/cv-data"

export function CVAbout() {
  return (
    <section id="about" className="cv-section py-12 md:py-16">
      <h2 className="cv-section-title">About Me</h2>
      <div className="cv-section-content">
        <p className="text-lg leading-relaxed text-slate-700 dark:text-slate-300">
          {cvData.about}
        </p>
      </div>
    </section>
  )
}
