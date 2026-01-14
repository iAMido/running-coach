"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"

export function CVSidebar() {
  const handleDownloadCV = () => {
    // Create a link element and trigger download
    const link = document.createElement('a')
    link.href = '/cv.pdf'
    link.download = 'Ido_Mosseri_CV.pdf'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <aside className="hidden lg:block sticky top-24 h-fit">
      <div className="space-y-6">
        {/* Profile Image */}
        <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center">
              <span className="text-6xl font-bold text-blue-600 dark:text-blue-400">
                IM
              </span>
            </div>
          </div>
        </div>

        {/* Download CV Button */}
        <Button
          onClick={handleDownloadCV}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          size="lg"
        >
          <Download className="h-5 w-5 mr-2" />
          Download CV
        </Button>

        {/* Quick Stats */}
        <div className="p-6 bg-gradient-to-br from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 rounded-xl space-y-4">
          <div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">10+</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Years of Experience</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">200%+</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Organic Traffic Growth</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
