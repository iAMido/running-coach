"use client"

import { cvData } from "@/lib/cv-data"

export function CVEducation() {
  return (
    <section id="education" className="cv-section py-12 md:py-16">
      <h2 className="cv-section-title">Education</h2>
      <div className="cv-section-content">
        <div className="space-y-6">
          {cvData.education.map((edu, index) => (
            <div key={index} className="relative pl-8 before:absolute before:left-0 before:top-2 before:w-3 before:h-3 before:bg-green-600 before:rounded-full before:ring-4 before:ring-green-100 dark:before:ring-green-900/30">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {edu.qualification}
                </h3>
                <p className="text-slate-700 dark:text-slate-300">
                  {edu.institution}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {edu.year}
                </p>
                {edu.note && (
                  <p className="text-sm italic text-slate-600 dark:text-slate-400 mt-2">
                    {edu.note}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
