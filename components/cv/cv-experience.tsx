"use client"

import { cvData } from "@/lib/cv-data"

export function CVExperience() {
  return (
    <section id="experience" className="cv-section py-12 md:py-16">
      <h2 className="cv-section-title">Work Experience</h2>
      <div className="cv-section-content">
        <div className="space-y-8">
          {cvData.experience.map((job, index) => (
            <div key={index} className="relative pl-8 before:absolute before:left-0 before:top-2 before:w-3 before:h-3 before:bg-blue-600 before:rounded-full before:ring-4 before:ring-blue-100 dark:before:ring-blue-900/30">
              <div className="space-y-2">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {job.position}
                  </h3>
                  <p className="text-lg text-blue-600 dark:text-blue-400 font-medium">
                    {job.company}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {job.duration}
                  </p>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {job.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
