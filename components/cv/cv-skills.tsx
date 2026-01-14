"use client"

import { cvData } from "@/lib/cv-data"

export function CVSkills() {
  return (
    <section id="skills" className="cv-section py-12 md:py-16">
      <h2 className="cv-section-title">Skills & Expertise</h2>
      <div className="cv-section-content">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {cvData.skills.map((skillGroup, index) => (
            <div key={index} className="space-y-3">
              <h3 className="text-xl font-semibold text-blue-600 dark:text-blue-400">
                {skillGroup.category}
              </h3>
              <ul className="space-y-2">
                {skillGroup.items.map((skill, skillIndex) => (
                  <li
                    key={skillIndex}
                    className="flex items-start gap-2 text-slate-700 dark:text-slate-300"
                  >
                    <span className="text-blue-600 dark:text-blue-400 mt-1">•</span>
                    <span>{skill}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
