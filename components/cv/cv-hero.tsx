"use client"

import { Mail, Phone, MapPin, Linkedin, Github, Twitter } from "lucide-react"
import { cvData } from "@/lib/cv-data"

export function CVHero() {
  const { personal, contact } = cvData

  return (
    <section className="cv-section py-12 md:py-20">
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 dark:text-white mb-2">
            {personal.name}
          </h1>
          <p className="text-xl md:text-2xl text-blue-600 dark:text-blue-400 font-medium">
            {personal.title}
          </p>
        </div>

        <div className="flex flex-col gap-3 text-slate-600 dark:text-slate-300">
          <a
            href={`tel:${personal.phone}`}
            className="flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Phone className="h-5 w-5" />
            <span>{personal.phone}</span>
          </a>
          <a
            href={`mailto:${personal.email}`}
            className="flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Mail className="h-5 w-5" />
            <span>{personal.email}</span>
          </a>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            <span>{personal.location}</span>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          {contact.social.map((social) => {
            const Icon = social.icon === "linkedin" ? Linkedin : social.icon === "github" ? Github : Twitter
            return (
              <a
                key={social.name}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                aria-label={social.name}
              >
                <Icon className="h-5 w-5" />
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}
