"use client"

import { Mail, Phone, MapPin, Linkedin, Github, Twitter } from "lucide-react"
import { cvData } from "@/lib/cv-data"

export function CVContact() {
  const { contact } = cvData

  return (
    <section id="contact" className="cv-section py-12 md:py-16">
      <h2 className="cv-section-title">Contact</h2>
      <div className="cv-section-content">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <a
              href={`tel:${contact.phone}`}
              className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
            >
              <Phone className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <span className="text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {contact.phone}
              </span>
            </a>

            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
            >
              <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <span className="text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {contact.email}
              </span>
            </a>

            <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <MapPin className="h-6 w-6 text-slate-600 dark:text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300">
                {contact.location}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Connect with me
            </h3>
            <div className="space-y-3">
              {contact.social.map((social) => {
                const Icon = social.icon === "linkedin" ? Linkedin : social.icon === "github" ? Github : Twitter
                return (
                  <a
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                  >
                    <Icon className="h-6 w-6 text-slate-600 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                    <span className="text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {social.name}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
