// CV Data Structure for Ido Mosseri
// Extracted from vite-spa-boilerplate

export interface PersonalInfo {
  name: string
  title: string
  phone: string
  email: string
  location: string
}

export interface SocialLink {
  name: string
  url: string
  icon: string
}

export interface Skill {
  category: string
  items: string[]
}

export interface WorkExperience {
  position: string
  company: string
  duration: string
  description: string
}

export interface Education {
  qualification: string
  institution: string
  year: string
  note?: string
}

export interface ContactInfo {
  phone: string
  email: string
  location: string
  social: SocialLink[]
}

export interface CVData {
  personal: PersonalInfo
  about: string
  skills: Skill[]
  experience: WorkExperience[]
  education: Education[]
  contact: ContactInfo
}

// CV Content
export const cvData: CVData = {
  personal: {
    name: "Ido Mosseri",
    title: "Technical SEO Lead",
    phone: "050-6790792",
    email: "idomosseri@gmail.com",
    location: "Kfar Saba, Israel"
  },

  about: "Results-oriented SEO Specialist with over 10 years of strategic and operational experience. While my core focus is organic growth, I bring a unique hybrid advantage: I lead select product features from PRD to deployment and execute hands-on technical implementations using AI-assisted workflows (Cursor, Claude, Gemini).\n\nI specialize in technical scalability, automation, and Generative Engine Optimization (GEO). By bridging the gap between marketing and engineering, I foster cross-functional collaboration to integrate SEO best practices directly into the development lifecycle.",

  skills: [
    {
      category: "AI & Automation",
      items: [
        "Vibe Coding (Cursor, Gemini, Claude)",
        "LLM Optimization (Technical & Onsite)",
        "CRM & Automation Processes",
        "Python & AI Tools"
      ]
    }, {
      category: "Technical SEO",
      items: [
        "Site architecture",
        "Crawlability optimization",
        "Structured data implementation",
        "Meta optimization",
        "Technical audits"
      ]
    },
    {
      category: "Content Strategy",
      items: [
        "Keyword research",
        "Content planning",
        "RankBrain optimization",
        "Comprehensive content strategies",
        "Content marketing"
      ]
    },
    {
      category: "Analytics & Tools",
      items: [
        "Google Analytics",
        "Search Console",
        "SEMrush",
        "Ahrefs",
        "Screaming Frog"
      ]
    },
    {
      category: "Programming",
      items: [
        "Python automation",
        "HTML/CSS",
        "WordPress development",
        "SEO tools development"
      ]
    },
    {
      category: "Link Building",
      items: [
        "High-quality link acquisition",
        "Outreach campaigns",
        "Penalty recovery",
        "Backlink analysis"
      ]
    },
    {
      category: "Conversion Optimization",
      items: [
        "A/B testing",
        "UX/UI principles",
        "Landing page optimization",
        "Conversion funnel analysis"
      ]
    }
  ],

  experience: [
    {
      position: "Technical SEO Lead",
      company: "Natural Intelligence",
      duration: "2021-Present",
      description: "Enhanced site health and architecture through strategic technical SEO. Led LLM optimization (technical and onsite) and cross-functional collaboration. Initiated and executed plans from PRD to development. Developed Python tools for automation and efficiency."
    },
    {
      position: "Head of SEO",
      company: "SearchVision",
      duration: "2019-2021",
      description: "Led company-wide SEO strategy across multiple sites; managed organic growth, audits, product collaboration."
    },
    {
      position: "Head of SEO",
      company: "Bookaway.com",
      duration: "2019-2020",
      description: "Developed SEO roadmap, executed technical projects, collaborated on content strategy, achieved 200%+ organic traffic increase."
    },
    {
      position: "Senior SEO Project Manager",
      company: "Webpals",
      duration: "2016-2018",
      description: "Managed casino business unit sites, led 7-person freelance team, executed long-term strategies, specialized in penalty recovery."
    },
    {
      position: "SEO Project Manager",
      company: "GO Internet Marketing",
      duration: "2013-2016",
      description: "Handled on-page/off-page SEO for Israeli companies, built content marketing strategies, managed link campaigns."
    }
  ],

  education: [
    {
      qualification: "Python for Data Analysts",
      institution: "Professional Development",
      year: "2021"
    },
    {
      qualification: "UX/UI Course",
      institution: "UXvision (Tal Florenitin)",
      year: "2018"
    },
    {
      qualification: "Internet Marketing Course",
      institution: "HackerU (SEO, SEM, Social)",
      year: "2013"
    },
    {
      qualification: "L.L.B in Law",
      institution: "College of Management Rishon Le'zion",
      year: "2005-2009",
      note: "Registered lawyer at Israeli Bar Association (2010)"
    }
  ],

  contact: {
    phone: "050-6790792",
    email: "idomosseri@gmail.com",
    location: "Kfar Saba, Israel",
    social: [
      {
        name: "LinkedIn",
        url: "https://www.linkedin.com/in/idomosseri/",
        icon: "linkedin"
      },
      {
        name: "GitHub",
        url: "https://github.com/iAMido",
        icon: "github"
      },
      {
        name: "Twitter",
        url: "https://twitter.com/idomosseri",
        icon: "twitter"
      }
    ]
  }
}
