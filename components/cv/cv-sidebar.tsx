"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"

// Supabase storage URLs
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ucjsnpnlxklaadqolpkx.supabase.co'
const PROFILE_IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/assets/profile-image.jpg`
const CV_URL = `${SUPABASE_URL}/storage/v1/object/public/assets/Ido-Mosseri-CV.pdf`

export function CVSidebar() {
  const handleDownloadCV = async () => {
    try {
      // Fetch the PDF and download it directly
      const response = await fetch(CV_URL)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'Ido_Mosseri_CV.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      // Fallback: open in new tab if download fails
      window.open(CV_URL, '_blank')
    }
  }

  return (
    <aside className="hidden lg:block sticky top-24 h-fit">
      <div className="space-y-6">
        {/* Profile Image */}
        <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-blue-50 to-green-50">
          <Image
            src={PROFILE_IMAGE_URL}
            alt="Ido Mosseri"
            fill
            className="object-cover object-top"
            priority
          />
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
        <div className="p-6 bg-gradient-to-br from-blue-50 to-green-50 rounded-xl space-y-4">
          <div>
            <p className="text-3xl font-bold text-blue-600">10+</p>
            <p className="text-sm text-slate-600">Years of Experience</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-green-600">200%+</p>
            <p className="text-sm text-slate-600">Organic Traffic Growth</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
