# 🏃 Personal Portfolio + AI Running Coach - Developer Blueprint

## Project Overview

Build a personal website using the [YUV Next.js Boilerplate](https://github.com/hoodini/nextjs-bun-starter) with:
1. **Main Page**: CV/Portfolio (design to be provided)
2. **Sub-app**: AI Running Coach at `/coach` route (authenticated, Gmail-based)

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Phase 1: Foundation Setup](#phase-1-foundation-setup)
5. [Phase 2: CV/Portfolio Main Page](#phase-2-cvportfolio-main-page)
6. [Phase 2.5: Blog System](#phase-25-blog-system-from-boilerplate)
7. [Phase 3: Running Coach App](#phase-3-running-coach-app)
8. [Phase 4: Database & API](#phase-4-database--api)
9. [Phase 5: AI Integration](#phase-5-ai-integration)
10. [Phase 6: Strava Integration](#phase-6-strava-integration)
11. [Phase 7: Deployment](#phase-7-deployment)
12. [Environment Variables](#environment-variables)
13. [API Endpoints](#api-endpoints)
14. [Database Schema](#database-schema)
15. [Security Considerations](#security-considerations)
16. [Migration from Streamlit](#migration-from-streamlit)
17. [Timeline Estimate](#timeline-estimate)

---

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Framework** | Next.js 16 (App Router) | From boilerplate |
| **Runtime** | Bun | 30x faster than npm |
| **Language** | TypeScript 5 | Strict mode |
| **Styling** | Tailwind CSS 4 + Shadcn/ui | Glassmorphism design |
| **Auth** | NextAuth.js | Google OAuth (Gmail) |
| **Database** | PostgreSQL (Supabase/Neon) | Or SQLite for simpler setup |
| **ORM** | Prisma or Drizzle | Type-safe DB access |
| **AI** | OpenRouter API | Claude + Grok models |
| **External API** | Strava API | Running data sync |
| **Hosting** | Vercel | Recommended |

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                          │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │   Main Page  │  │     /blog       │  │      /coach (Protected)          │  │
│  │  CV/Portfolio│  │  ┌───────────┐  │  │  ┌─────────┐ ┌───────────────┐  │  │
│  │              │  │  │ Articles  │  │  │  │Dashboard│ │Training Plan  │  │  │
│  │   (Public)   │  │  │ List      │  │  │  ├─────────┤ ├───────────────┤  │  │
│  │              │  │  ├───────────┤  │  │  │Weekly   │ │Ask Coach (Q&A)│  │  │
│  │              │  │  │ Article   │  │  │  │Review   │ ├───────────────┤  │  │
│  │              │  │  │ Detail    │  │  │  ├─────────┤ │Grocky Balboa  │  │  │
│  │              │  │  ├───────────┤  │  │  │Sync     │ │(2nd Opinion)  │  │  │
│  │              │  │  │ TTS Audio │  │  │  │Strava   │ └───────────────┘  │  │
│  │              │  │  │ Player    │  │  │  └─────────┘                     │  │
│  └──────────────┘  │  └───────────┘  │  └─────────────────────────────────┘  │
│                    │    (Public)     │                                        │
│                    └─────────────────┘                                        │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              API ROUTES                                        │
│  /api/auth/*     - NextAuth (Google OAuth)                                    │
│  /api/coach/*    - Running coach endpoints                                    │
│  /api/strava/*   - Strava OAuth & sync                                        │
│  /api/blog/*     - Blog CRUD (admin only)                                     │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE (PostgreSQL)                                │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐    │
│  │     RUNNING COACH DATA      │  │           BLOG/CONTENT DATA          │    │
│  │  • runs                     │  │  • blog_posts                        │    │
│  │  • training_plans           │  │  • blog_categories                   │    │
│  │  • athlete_profile          │  │  • blog_tags                         │    │
│  │  • weekly_feedback          │  │  • post_tags (junction)              │    │
│  │  • workout_library          │  │                                      │    │
│  │  • strava_account           │  │                                      │    │
│  └─────────────────────────────┘  └─────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │OpenRouter│  │  Strava  │  │  Google  │  │  (opt)   │                      │
│  │   API    │  │   API    │  │  OAuth   │  │ Cloudinary│                     │
│  │Claude+Grok│ │Run Data  │  │  Auth    │  │  Images  │                      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Data Domains

| Domain | Tables | Access | Description |
|--------|--------|--------|-------------|
| **Running Coach** | runs, training_plans, athlete_profile, weekly_feedback, workout_library, strava_account | Private (auth required) | Personal training data |
| **Blog/Content** | blog_posts, blog_categories, blog_tags, post_tags | Public read, Admin write | Articles with TTS support |
| **User/Auth** | users, accounts, sessions | System | NextAuth managed |

---

## Project Structure

```
my-site/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/
│   │   │   └── route.ts              # Google OAuth
│   │   ├── coach/
│   │   │   ├── analyze/route.ts      # Weekly analysis
│   │   │   ├── plan/route.ts         # Generate/get plan
│   │   │   ├── chat/route.ts         # Q&A with coach
│   │   │   ├── grocky/route.ts       # Grocky second opinion
│   │   │   └── runs/route.ts         # CRUD for runs
│   │   ├── strava/
│   │   │   ├── auth/route.ts         # Strava OAuth
│   │   │   ├── callback/route.ts     # OAuth callback
│   │   │   └── sync/route.ts         # Sync runs
│   │   └── blog/
│   │       ├── posts/route.ts        # Get all posts
│   │       ├── posts/[slug]/route.ts # Get single post
│   │       └── admin/route.ts        # CRUD (admin only)
│   │
│   ├── blog/                         # PUBLIC - Blog pages (from boilerplate)
│   │   ├── layout.tsx                # Blog layout
│   │   ├── page.tsx                  # Blog listing with glassmorphism cards
│   │   └── [slug]/
│   │       └── page.tsx              # Article page with TTS player
│   │
│   ├── coach/                        # PROTECTED - Running coach app
│   │   ├── layout.tsx                # Coach app layout (sidebar nav)
│   │   ├── page.tsx                  # Dashboard
│   │   ├── plan/page.tsx             # Training plan
│   │   ├── review/page.tsx           # Weekly review
│   │   ├── ask/page.tsx              # Q&A chat
│   │   ├── grocky/page.tsx           # Second opinion
│   │   ├── sync/page.tsx             # Strava sync
│   │   └── settings/page.tsx         # User settings
│   │
│   ├── admin/                        # PROTECTED - Admin area
│   │   ├── layout.tsx                # Admin layout
│   │   ├── page.tsx                  # Admin dashboard
│   │   └── blog/
│   │       ├── page.tsx              # Manage posts
│   │       ├── new/page.tsx          # Create post
│   │       └── [slug]/edit/page.tsx  # Edit post
│   │
│   ├── globals.css
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # CV/Portfolio (main page)
│   └── providers.tsx
│
├── components/
│   ├── cv/                           # CV page components
│   │   ├── hero-section.tsx
│   │   ├── experience-section.tsx
│   │   ├── skills-section.tsx
│   │   └── contact-section.tsx
│   │
│   ├── blog/                         # Blog components (FROM BOILERPLATE - keep these!)
│   │   ├── article-content.tsx       # Article with TTS player
│   │   ├── article-card.tsx          # Glassmorphism card preview
│   │   ├── reading-progress.tsx      # Progress bar
│   │   ├── tts-player.tsx            # Spotify-style audio player
│   │   ├── category-tag.tsx          # Color-coded tags
│   │   └── reading-time.tsx          # Time estimate
│   │
│   ├── coach/                        # Coach app components
│   │   ├── sidebar.tsx               # Navigation sidebar
│   │   ├── dashboard-stats.tsx
│   │   ├── run-table.tsx
│   │   ├── plan-display.tsx
│   │   ├── week-selector.tsx
│   │   ├── chat-interface.tsx        # Reusable chat UI
│   │   ├── weekly-review-form.tsx
│   │   └── strava-connect.tsx
│   │
│   ├── layout/                       # FROM BOILERPLATE - keep these!
│   │   ├── navbar.tsx                # Floating glass navbar
│   │   ├── footer.tsx
│   │   ├── mobile-menu.tsx           # Hamburger menu
│   │   └── scroll-to-top.tsx         # Scroll button
│   │
│   └── ui/                           # Shadcn + custom UI components
│       ├── glass-card.tsx            # Glassmorphism card
│       ├── copy-button.tsx           # Copy to clipboard
│       └── ...                       # Other Shadcn components
│
├── lib/
│   ├── db/
│   │   ├── client.ts                 # Prisma client
│   │   ├── schema.ts                 # Type definitions
│   │   ├── queries/
│   │   │   ├── runs.ts               # Run queries
│   │   │   ├── plans.ts              # Plan queries
│   │   │   ├── blog.ts               # Blog queries
│   │   │   └── profile.ts            # Profile queries
│   │   └── index.ts
│   │
│   ├── ai/
│   │   ├── openrouter.ts             # API client
│   │   ├── coach.ts                  # Main coach logic
│   │   ├── coach-qa.ts               # Q&A handler
│   │   ├── coach-grocky.ts           # Grocky Balboa
│   │   └── prompts.ts                # System prompts
│   │
│   ├── strava/
│   │   ├── auth.ts                   # OAuth helpers
│   │   └── sync.ts                   # Sync logic
│   │
│   ├── blog/
│   │   ├── utils.ts                  # Reading time calc, etc.
│   │   └── tts.ts                    # TTS helpers
│   │
│   ├── auth.ts                       # NextAuth config
│   └── utils.ts
│
├── prisma/
│   └── schema.prisma                 # Database schema
│
├── public/
│   └── ...
│
├── .env.example
├── .env.local
└── package.json
```

---

## Phase 1: Foundation Setup

### 1.1 Initialize Project

```bash
# Create project from boilerplate
bun create yuv-bun-app my-site
cd my-site

# Install additional dependencies
bun add prisma @prisma/client
bun add -d prisma

# Or if using Drizzle
bun add drizzle-orm postgres
bun add -d drizzle-kit
```

### 1.2 Additional Dependencies

```bash
# AI & API
bun add openai  # OpenRouter uses OpenAI-compatible API

# Forms & Validation
bun add react-hook-form zod @hookform/resolvers

# Date handling
bun add date-fns

# Charts (for dashboard)
bun add recharts

# File handling (for Garmin FIT export - optional)
bun add fit-file-writer
```

### 1.3 Configure NextAuth for Google

The boilerplate includes NextAuth setup. Verify `app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      // Add user ID to session
      if (session.user) {
        session.user.id = token.sub!
      }
      return session
    },
  },
})

export { handler as GET, handler as POST }
```

---

## Phase 2: CV/Portfolio Main Page

### 2.1 Main Page Structure

The main page (`app/page.tsx`) will be the CV/Portfolio.

```typescript
// app/page.tsx
import { HeroSection } from '@/components/cv/hero-section'
import { ExperienceSection } from '@/components/cv/experience-section'
import { SkillsSection } from '@/components/cv/skills-section'
import { ProjectsSection } from '@/components/cv/projects-section'
import { ContactSection } from '@/components/cv/contact-section'

export default function HomePage() {
  return (
    <main>
      <HeroSection />
      <ExperienceSection />
      <SkillsSection />
      <ProjectsSection />
      <ContactSection />
    </main>
  )
}
```

### 2.2 Navigation Update

Update navbar to include link to coach app and blog:

```typescript
// components/layout/navbar.tsx
const navItems = [
  { name: 'About', href: '#about' },
  { name: 'Experience', href: '#experience' },
  { name: 'Skills', href: '#skills' },
  { name: 'Blog', href: '/blog' },           // Public blog
  { name: 'Contact', href: '#contact' },
  { name: 'Running Coach', href: '/coach' }, // Protected route
]
```

---

## Phase 2.5: Blog System (From Boilerplate)

> **IMPORTANT**: The YUV boilerplate already includes a complete blog system. 
> The developer needs to **KEEP these components** and connect them to the database.

### 2.5.1 Features to Keep from Boilerplate

The boilerplate includes these blog features - **DO NOT REMOVE**:

| Component | File | Description |
|-----------|------|-------------|
| **Glassmorphism Cards** | `components/blog/article-card.tsx` | Beautiful hover effects |
| **Reading Progress Bar** | `components/blog/reading-progress.tsx` | Fixed scroll indicator |
| **TTS Player** | `components/blog/tts-player.tsx` | Spotify-style audio |
| **Voice Selection** | Part of TTS player | System voice picker |
| **Speed Control** | Part of TTS player | 0.5x to 2x |
| **Category Tags** | `components/blog/category-tag.tsx` | Color-coded |
| **Reading Time** | `components/blog/reading-time.tsx` | Auto-calculated |
| **Article Content** | `components/blog/article-content.tsx` | Mobile-optimized prose |

### 2.5.2 Modify Blog to Use Database

**Current (Static)**: `lib/blog.ts` contains hardcoded posts
**New (Database)**: Fetch from PostgreSQL via Prisma

```typescript
// lib/db/queries/blog.ts
import { prisma } from '../client'

export async function getAllPosts(options?: {
  status?: 'published' | 'draft'
  categorySlug?: string
  limit?: number
}) {
  return prisma.blogPost.findMany({
    where: {
      status: options?.status || 'published',
      ...(options?.categorySlug && {
        category: { slug: options.categorySlug }
      }),
    },
    include: {
      category: true,
      tags: { include: { tag: true } },
      author: { select: { name: true, image: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: options?.limit,
  })
}

export async function getPostBySlug(slug: string) {
  return prisma.blogPost.findUnique({
    where: { slug },
    include: {
      category: true,
      tags: { include: { tag: true } },
      author: { select: { name: true, image: true } },
    },
  })
}

export async function getCategories() {
  return prisma.blogCategory.findMany({
    include: {
      _count: { select: { posts: true } }
    }
  })
}

export async function getFeaturedPosts(limit: number = 3) {
  return prisma.blogPost.findMany({
    where: { 
      status: 'published',
      featured: true 
    },
    include: { category: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  })
}
```

### 2.5.3 Update Blog Pages

```typescript
// app/blog/page.tsx
import { getAllPosts, getCategories } from '@/lib/db/queries/blog'
import { ArticleCard } from '@/components/blog/article-card'
import { CategoryFilter } from '@/components/blog/category-filter'

export default async function BlogPage({
  searchParams,
}: {
  searchParams: { category?: string }
}) {
  const [posts, categories] = await Promise.all([
    getAllPosts({ 
      status: 'published',
      categorySlug: searchParams.category 
    }),
    getCategories(),
  ])

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">Blog</h1>
      
      <CategoryFilter 
        categories={categories} 
        activeSlug={searchParams.category} 
      />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        {posts.map((post) => (
          <ArticleCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  )
}
```

```typescript
// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { getPostBySlug, getAllPosts } from '@/lib/db/queries/blog'
import { ArticleContent } from '@/components/blog/article-content'
import { ReadingProgress } from '@/components/blog/reading-progress'

// Generate static params for published posts
export async function generateStaticParams() {
  const posts = await getAllPosts({ status: 'published' })
  return posts.map((post) => ({ slug: post.slug }))
}

export default async function ArticlePage({
  params,
}: {
  params: { slug: string }
}) {
  const post = await getPostBySlug(params.slug)
  
  if (!post || post.status !== 'published') {
    notFound()
  }

  return (
    <>
      <ReadingProgress />
      <ArticleContent post={post} />
    </>
  )
}
```

### 2.5.4 TTS Player Integration

The TTS player uses the `content` field (plain text) for speech synthesis:

```typescript
// components/blog/tts-player.tsx (already in boilerplate - may need minor updates)
'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Select } from '@/components/ui/select'

interface TTSPlayerProps {
  content: string  // Plain text content for TTS
  title: string
}

export function TTSPlayer({ content, title }: TTSPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const [rate, setRate] = useState(1)
  const [progress, setProgress] = useState(0)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    // Load available voices
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices()
      setVoices(availableVoices)
      if (availableVoices.length > 0 && !selectedVoice) {
        setSelectedVoice(availableVoices[0].name)
      }
    }
    
    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices
    
    return () => {
      speechSynthesis.cancel()
    }
  }, [])

  const togglePlay = () => {
    if (isPlaying) {
      speechSynthesis.pause()
      setIsPlaying(false)
    } else if (speechSynthesis.paused) {
      speechSynthesis.resume()
      setIsPlaying(true)
    } else {
      const utterance = new SpeechSynthesisUtterance(content)
      utterance.voice = voices.find(v => v.name === selectedVoice) || null
      utterance.rate = rate
      
      utterance.onend = () => {
        setIsPlaying(false)
        setProgress(0)
      }
      
      utterance.onboundary = (event) => {
        setProgress((event.charIndex / content.length) * 100)
      }
      
      utteranceRef.current = utterance
      speechSynthesis.speak(utterance)
      setIsPlaying(true)
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t p-4">
      <div className="container mx-auto flex items-center gap-4">
        {/* Progress bar */}
        <div className="flex-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-2">
          <button onClick={togglePlay} className="p-2 hover:bg-muted rounded-full">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
        </div>
        
        {/* Speed control */}
        <select 
          value={rate} 
          onChange={(e) => setRate(Number(e.target.value))}
          className="bg-muted px-2 py-1 rounded text-sm"
        >
          <option value={0.5}>0.5x</option>
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
        
        {/* Voice selection */}
        <select
          value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
          className="bg-muted px-2 py-1 rounded text-sm max-w-[150px]"
        >
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
```

### 2.5.5 Admin Blog Management

```typescript
// app/admin/blog/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAllPosts } from '@/lib/db/queries/blog'
import { AdminPostsTable } from '@/components/admin/posts-table'

export default async function AdminBlogPage() {
  const session = await getServerSession(authOptions)
  
  // Only allow admin users
  if (!session || session.user.role !== 'admin') {
    redirect('/')
  }
  
  const posts = await getAllPosts() // Get all posts including drafts
  
  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Manage Blog Posts</h1>
        <a href="/admin/blog/new" className="btn btn-primary">
          + New Post
        </a>
      </div>
      
      <AdminPostsTable posts={posts} />
    </div>
  )
}
```

### 2.5.6 Blog API Routes

```typescript
// app/api/blog/posts/route.ts
import { NextResponse } from 'next/server'
import { getAllPosts } from '@/lib/db/queries/blog'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') || undefined
  const limit = searchParams.get('limit') 
    ? parseInt(searchParams.get('limit')!) 
    : undefined
  
  const posts = await getAllPosts({ 
    status: 'published',
    categorySlug: category,
    limit,
  })
  
  return NextResponse.json(posts)
}
```

```typescript
// app/api/blog/admin/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db/client'
import { calculateReadingTime } from '@/lib/blog/utils'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const body = await request.json()
  
  const post = await prisma.blogPost.create({
    data: {
      slug: body.slug,
      title: body.title,
      description: body.description,
      content: body.content,           // Plain text for TTS
      contentHtml: body.contentHtml,   // HTML for rendering
      coverImage: body.coverImage,
      readingTimeMin: calculateReadingTime(body.content),
      status: body.status || 'draft',
      authorId: session.user.id,
      categoryId: body.categoryId,
    }
  })
  
  return NextResponse.json(post)
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const body = await request.json()
  
  const post = await prisma.blogPost.update({
    where: { id: body.id },
    data: {
      title: body.title,
      description: body.description,
      content: body.content,
      contentHtml: body.contentHtml,
      coverImage: body.coverImage,
      readingTimeMin: calculateReadingTime(body.content),
      status: body.status,
      categoryId: body.categoryId,
      publishedAt: body.status === 'published' ? new Date() : null,
    }
  })
  
  return NextResponse.json(post)
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  
  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 })
  }
  
  await prisma.blogPost.delete({ where: { id } })
  
  return NextResponse.json({ success: true })
}
```

### 2.5.7 Blog Utilities

```typescript
// lib/blog/utils.ts

/**
 * Calculate reading time based on word count
 * Average reading speed: 200-250 words per minute
 */
export function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200
  const words = content.trim().split(/\s+/).length
  return Math.ceil(words / wordsPerMinute)
}

/**
 * Generate slug from title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Strip HTML for TTS content
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
```

---

## Phase 3: Running Coach App

### 3.1 Protected Layout

```typescript
// app/coach/layout.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CoachSidebar } from '@/components/coach/sidebar'

export default async function CoachLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect('/api/auth/signin?callbackUrl=/coach')
  }

  return (
    <div className="flex min-h-screen">
      <CoachSidebar />
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  )
}
```

### 3.2 Coach Sidebar Navigation

```typescript
// components/coach/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  LayoutDashboard, 
  Calendar, 
  MessageSquare, 
  Target,
  RefreshCw,
  Settings,
  Brain
} from 'lucide-react'

const navItems = [
  { name: 'Dashboard', href: '/coach', icon: LayoutDashboard },
  { name: 'Training Plan', href: '/coach/plan', icon: Target },
  { name: 'Weekly Review', href: '/coach/review', icon: Calendar },
  { name: 'Ask Coach', href: '/coach/ask', icon: MessageSquare },
  { name: 'Grocky Balboa', href: '/coach/grocky', icon: Brain },
  { name: 'Sync Strava', href: '/coach/sync', icon: RefreshCw },
  { name: 'Settings', href: '/coach/settings', icon: Settings },
]

export function CoachSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-background border-r">
      <div className="p-4">
        <h2 className="text-xl font-bold">🏃 Running Coach</h2>
      </div>
      <nav className="space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-primary text-primary-foreground' 
                  : 'hover:bg-muted'
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

### 3.3 Dashboard Page

```typescript
// app/coach/page.tsx
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DashboardStats } from '@/components/coach/dashboard-stats'
import { RecentRuns } from '@/components/coach/recent-runs'
import { CurrentWeek } from '@/components/coach/current-week'
import { getRecentRuns, getCurrentPlan } from '@/lib/db/queries'

export default async function CoachDashboard() {
  const session = await getServerSession(authOptions)
  const userId = session!.user.id
  
  const [recentRuns, currentPlan] = await Promise.all([
    getRecentRuns(userId, 14),
    getCurrentPlan(userId),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">📊 Dashboard</h1>
      
      <DashboardStats runs={recentRuns} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentRuns runs={recentRuns} />
        <CurrentWeek plan={currentPlan} />
      </div>
    </div>
  )
}
```

### 3.4 Chat Interface (Reusable for Q&A and Grocky)

```typescript
// components/coach/chat-interface.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatInterfaceProps {
  endpoint: string  // '/api/coach/chat' or '/api/coach/grocky'
  placeholder?: string
  systemContext?: Record<string, any>
}

export function ChatInterface({ 
  endpoint, 
  placeholder = "Type your message...",
  systemContext 
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: userMessage }],
          context: systemContext,
        }),
      })

      const data = await response.json()
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data.response 
      }])
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '❌ Error: Could not get response. Please try again.' 
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[600px] border rounded-lg">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <div className="prose prose-sm dark:prose-invert">
                  {message.content}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      
      <div className="p-4 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage()
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
```

---

## Phase 4: Database & API

### 4.1 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"  // or "sqlite"
  url      = env("DATABASE_URL")
}

// =============================================================================
// AUTH & USER (NextAuth managed)
// =============================================================================

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  role          String    @default("user")  // "user" | "admin"
  createdAt     DateTime  @default(now())
  
  // Relations
  athleteProfile AthleteProfile?
  runs          Run[]
  trainingPlans TrainingPlan[]
  weeklyFeedback WeeklyFeedback[]
  stravaAccount StravaAccount?
  blogPosts     BlogPost[]  // Posts authored by user (admin)
}

// =============================================================================
// RUNNING COACH DATA
// =============================================================================

model AthleteProfile {
  id                String  @id @default(cuid())
  userId            String  @unique
  user              User    @relation(fields: [userId], references: [id])
  
  // Basic info
  age               Int?
  weightKg          Float?
  heightCm          Float?
  
  // HR Zones
  restingHr         Int?
  maxHr             Int?
  lactateThresholdHr Int?
  hrZoneZ1          String?  // "0-120"
  hrZoneZ2          String?  // "120-138"
  hrZoneZ3          String?  // "138-150"
  hrZoneZ4          String?  // "150-162"
  hrZoneZ5          String?  // "162-175"
  hrZoneZ6          String?  // "175-185"
  
  // Goals & Notes
  currentGoal       String?
  trainingDays      String?  // "Mon, Wed, Fri"
  injuryHistory     String?
  
  updatedAt         DateTime @updatedAt
}

model Run {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  
  // Core data
  date            DateTime
  distanceKm      Float
  durationMin     Float
  avgHr           Int?
  maxHr           Int?
  avgPaceMin      Float?   // min/km as decimal
  avgPaceStr      String?  // "6:30"
  
  // HR Zone distribution (percentages)
  pctZ1           Float?
  pctZ2           Float?
  pctZ3           Float?
  pctZ4           Float?
  pctZ5           Float?
  pctZ6           Float?
  
  // Metadata
  runType         String?  // "Easy", "Tempo", etc.
  workoutName     String?
  coachNotes      String?
  trimp           Float?
  
  // Strava
  stravaActivityId String?
  
  createdAt       DateTime @default(now())
  
  @@index([userId, date])
}

model TrainingPlan {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  
  planType        String   // "Half Marathon", "Base Building"
  planJson        Json     // Full plan structure
  durationWeeks   Int
  status          String   @default("active")  // "active", "completed", "deleted"
  
  // Week tracking
  startDate       DateTime
  currentWeekNum  Int      @default(1)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([userId, status])
}

model WeeklyFeedback {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  
  weekStart       DateTime
  overallFeeling  Int?     // 1-10
  sleepQuality    Int?     // 1-10
  stressLevel     Int?     // 1-10
  injuryNotes     String?
  achievements    String?
  aiAnalysis      String?
  
  createdAt       DateTime @default(now())
  
  @@index([userId, weekStart])
}

model StravaAccount {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  
  stravaAthleteId Int
  accessToken     String
  refreshToken    String
  expiresAt       DateTime
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model WorkoutLibrary {
  id              String   @id @default(cuid())
  userId          String?  // null = global templates
  
  workoutName     String
  category        String?
  coachNotes      String?
  typicalDistanceKm Float?
  typicalDurationMin Float?
  targetZone      String?
  purpose         String?
  count           Int      @default(1)
  
  @@index([userId, category])
}

// =============================================================================
// BLOG / CONTENT DATA
// =============================================================================

model BlogPost {
  id              String   @id @default(cuid())
  
  // URL & SEO
  slug            String   @unique
  title           String
  description     String?  // Meta description
  
  // Content
  content         String   // Plain text for TTS
  contentHtml     String   @db.Text  // HTML for rendering
  
  // Media
  coverImage      String?  // URL to cover image
  coverImageAlt   String?  // Alt text for accessibility
  
  // Metadata
  readingTimeMin  Int?     // Calculated from content
  publishedAt     DateTime?
  status          String   @default("draft")  // "draft" | "published" | "archived"
  featured        Boolean  @default(false)
  
  // Author
  authorId        String?
  author          User?    @relation(fields: [authorId], references: [id])
  
  // Relations
  categoryId      String?
  category        BlogCategory? @relation(fields: [categoryId], references: [id])
  tags            PostTag[]
  
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([status, publishedAt])
  @@index([slug])
  @@index([categoryId])
}

model BlogCategory {
  id              String   @id @default(cuid())
  name            String   @unique
  slug            String   @unique
  description     String?
  color           String?  // Hex color for UI (e.g., "#3B82F6")
  
  // Relations
  posts           BlogPost[]
  
  createdAt       DateTime @default(now())
}

model BlogTag {
  id              String   @id @default(cuid())
  name            String   @unique
  slug            String   @unique
  
  // Relations
  posts           PostTag[]
  
  createdAt       DateTime @default(now())
}

model PostTag {
  id              String   @id @default(cuid())
  postId          String
  tagId           String
  
  post            BlogPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  tag             BlogTag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  
  @@unique([postId, tagId])
}
```

### 4.2 Database Queries

```typescript
// lib/db/queries.ts
import { prisma } from './client'

export async function getRecentRuns(userId: string, days: number = 14) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  
  return prisma.run.findMany({
    where: {
      userId,
      date: { gte: cutoffDate }
    },
    orderBy: { date: 'desc' }
  })
}

export async function getCurrentPlan(userId: string) {
  return prisma.trainingPlan.findFirst({
    where: {
      userId,
      status: 'active'
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getAthleteProfile(userId: string) {
  return prisma.athleteProfile.findUnique({
    where: { userId }
  })
}

export async function getTrainingStats(userId: string, weeks: number = 8) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - weeks * 7)
  
  const runs = await prisma.run.findMany({
    where: {
      userId,
      date: { gte: cutoffDate }
    },
    orderBy: { date: 'desc' }
  })
  
  // Calculate zone averages
  const zoneAvg = runs.reduce((acc, run) => ({
    z1: acc.z1 + (run.pctZ1 || 0),
    z2: acc.z2 + (run.pctZ2 || 0),
    z3: acc.z3 + (run.pctZ3 || 0),
    z4: acc.z4 + (run.pctZ4 || 0),
    z5: acc.z5 + (run.pctZ5 || 0),
    z6: acc.z6 + (run.pctZ6 || 0),
  }), { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0 })
  
  const count = runs.length || 1
  
  return {
    runs,
    hrZoneDistribution: {
      Z1: zoneAvg.z1 / count,
      Z2: zoneAvg.z2 / count,
      Z3: zoneAvg.z3 / count,
      Z4: zoneAvg.z4 / count,
      Z5: zoneAvg.z5 / count,
      Z6: zoneAvg.z6 / count,
    },
    totalRuns: count,
    totalKm: runs.reduce((sum, r) => sum + r.distanceKm, 0),
  }
}

export async function savePlan(userId: string, plan: any, planType: string, weeks: number) {
  // Deactivate existing plans
  await prisma.trainingPlan.updateMany({
    where: { userId, status: 'active' },
    data: { status: 'completed' }
  })
  
  // Calculate start date
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysToMonday = dayOfWeek === 0 ? 1 : dayOfWeek <= 3 ? -dayOfWeek + 1 : 8 - dayOfWeek
  const startDate = new Date(today)
  startDate.setDate(today.getDate() + daysToMonday)
  
  return prisma.trainingPlan.create({
    data: {
      userId,
      planType,
      planJson: plan,
      durationWeeks: weeks,
      startDate,
      currentWeekNum: 1,
    }
  })
}

export async function updatePlanWeek(planId: string, weekNum: number) {
  return prisma.trainingPlan.update({
    where: { id: planId },
    data: { currentWeekNum: weekNum }
  })
}
```

---

## Phase 5: AI Integration

### 5.1 OpenRouter Client

```typescript
// lib/ai/openrouter.ts

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterOptions {
  model: string
  maxTokens?: number
  temperature?: number
}

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  options: OpenRouterOptions
): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
      'X-Title': 'AI Running Coach',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature || 0.7,
      messages,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'OpenRouter API error')
  }

  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}

// Model constants
export const MODELS = {
  CLAUDE: 'anthropic/claude-sonnet-4',
  GROK: 'x-ai/grok-4',
}
```

### 5.2 Coach Logic

```typescript
// lib/ai/coach.ts
import { callOpenRouter, MODELS } from './openrouter'
import { getAthleteProfile, getTrainingStats } from '@/lib/db/queries'

export async function generatePlan(
  userId: string,
  planType: string,
  durationWeeks: number,
  runsPerWeek: number,
  targetRace?: string,
  notes?: string
) {
  const profile = await getAthleteProfile(userId)
  const stats = await getTrainingStats(userId, 8)
  
  const systemPrompt = buildCoachSystemPrompt(profile)
  const userPrompt = buildPlanPrompt(planType, durationWeeks, runsPerWeek, targetRace, notes, stats)
  
  const response = await callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { model: MODELS.CLAUDE, maxTokens: 4000 }
  )
  
  // Parse JSON from response
  return parseJsonResponse(response)
}

export async function analyzeWeek(userId: string, weekData: any) {
  const profile = await getAthleteProfile(userId)
  const stats = await getTrainingStats(userId, 4)
  
  const systemPrompt = buildCoachSystemPrompt(profile)
  const userPrompt = buildAnalysisPrompt(weekData, stats)
  
  return callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { model: MODELS.CLAUDE, maxTokens: 2000 }
  )
}

export async function chat(userId: string, messages: any[]) {
  const profile = await getAthleteProfile(userId)
  const plan = await getCurrentPlan(userId)
  
  const systemPrompt = buildQASystemPrompt(profile, plan)
  
  return callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    { model: MODELS.CLAUDE, maxTokens: 1500 }
  )
}
```

### 5.3 Grocky Balboa

```typescript
// lib/ai/grocky.ts
import { callOpenRouter, MODELS } from './openrouter'
import { getAthleteProfile, getTrainingStats, getCurrentPlan } from '@/lib/db/queries'

export async function reviewPlan(userId: string) {
  const profile = await getAthleteProfile(userId)
  const plan = await getCurrentPlan(userId)
  const stats = await getTrainingStats(userId, 8)
  
  if (!plan) {
    return '⚠️ No active training plan found. Please create a plan first.'
  }
  
  const systemPrompt = buildGrockySystemPrompt(profile)
  const userPrompt = buildReviewPrompt(plan, stats)
  
  return callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { model: MODELS.GROK, maxTokens: 2500 }
  )
}

export async function grockyChat(userId: string, messages: any[]) {
  const profile = await getAthleteProfile(userId)
  const plan = await getCurrentPlan(userId)
  const stats = await getTrainingStats(userId, 4)
  
  const systemPrompt = buildGrockySystemPrompt(profile)
  const contextMessage = buildContextMessage(plan, stats)
  
  return callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextMessage },
      { role: 'assistant', content: 'I have your training data loaded. How can I help you analyze your training?' },
      ...messages,
    ],
    { model: MODELS.GROK, maxTokens: 1500 }
  )
}
```

### 5.4 API Routes

```typescript
// app/api/coach/chat/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { chat } from '@/lib/ai/coach'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { messages } = await request.json()
  
  try {
    const response = await chat(session.user.id, messages)
    return NextResponse.json({ response })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get response' },
      { status: 500 }
    )
  }
}
```

```typescript
// app/api/coach/grocky/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { reviewPlan, grockyChat } from '@/lib/ai/grocky'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { action, messages } = await request.json()
  
  try {
    if (action === 'review') {
      const response = await reviewPlan(session.user.id)
      return NextResponse.json({ response })
    } else {
      const response = await grockyChat(session.user.id, messages)
      return NextResponse.json({ response })
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get response' },
      { status: 500 }
    )
  }
}
```

---

## Phase 6: Strava Integration

### 6.1 Strava OAuth Flow

```typescript
// lib/strava/auth.ts

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'

export function getStravaAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/strava/callback`,
    response_type: 'code',
    scope: 'read,activity:read_all',
    state,
  })
  
  return `${STRAVA_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code: string) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  })
  
  return response.json()
}

export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  
  return response.json()
}
```

### 6.2 Strava Sync

```typescript
// lib/strava/sync.ts
import { prisma } from '@/lib/db/client'
import { refreshAccessToken } from './auth'

const STRAVA_API = 'https://www.strava.com/api/v3'

export async function syncStravaRuns(userId: string, days: number = 30) {
  // Get Strava account
  const stravaAccount = await prisma.stravaAccount.findUnique({
    where: { userId }
  })
  
  if (!stravaAccount) {
    throw new Error('Strava not connected')
  }
  
  // Refresh token if needed
  let accessToken = stravaAccount.accessToken
  if (new Date(stravaAccount.expiresAt) < new Date()) {
    const tokens = await refreshAccessToken(stravaAccount.refreshToken)
    accessToken = tokens.access_token
    
    await prisma.stravaAccount.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
      }
    })
  }
  
  // Fetch activities
  const after = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60)
  const response = await fetch(
    `${STRAVA_API}/athlete/activities?after=${after}&per_page=100`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  )
  
  const activities = await response.json()
  
  // Filter runs and sync to database
  const runs = activities.filter((a: any) => a.type === 'Run')
  
  let synced = 0
  for (const run of runs) {
    // Check if already exists
    const existing = await prisma.run.findFirst({
      where: { stravaActivityId: String(run.id) }
    })
    
    if (!existing) {
      await prisma.run.create({
        data: {
          userId,
          date: new Date(run.start_date),
          distanceKm: run.distance / 1000,
          durationMin: run.moving_time / 60,
          avgHr: run.average_heartrate,
          maxHr: run.max_heartrate,
          avgPaceMin: (run.moving_time / 60) / (run.distance / 1000),
          avgPaceStr: formatPace((run.moving_time / 60) / (run.distance / 1000)),
          workoutName: run.name,
          stravaActivityId: String(run.id),
        }
      })
      synced++
    }
  }
  
  return { synced, total: runs.length }
}

function formatPace(paceDecimal: number): string {
  const mins = Math.floor(paceDecimal)
  const secs = Math.round((paceDecimal - mins) * 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
```

---

## Phase 7: Deployment

### 7.1 Vercel Deployment

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables (see below)
4. Deploy

### 7.2 Database Setup

**Option A: Supabase (Recommended)**
```bash
# Create project at supabase.com
# Get connection string from Settings > Database
DATABASE_URL="postgresql://..."
```

**Option B: Neon**
```bash
# Create project at neon.tech
DATABASE_URL="postgresql://..."
```

**Option C: PlanetScale (MySQL)**
```bash
# Requires changing Prisma schema to MySQL
DATABASE_URL="mysql://..."
```

### 7.3 Post-Deployment

1. Update Google OAuth redirect URIs for production domain
2. Update Strava OAuth callback URL
3. Run database migrations: `bunx prisma migrate deploy`

---

## Environment Variables

```bash
# .env.example

# Database
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# OpenRouter AI
OPENROUTER_API_KEY="your-openrouter-api-key"

# Strava
STRAVA_CLIENT_ID="your-strava-client-id"
STRAVA_CLIENT_SECRET="your-strava-client-secret"
```

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/*` | - | - | NextAuth routes |
| **Coach API** |
| `/api/coach/plan` | GET | User | Get current plan |
| `/api/coach/plan` | POST | User | Generate new plan |
| `/api/coach/plan/week` | PATCH | User | Update current week |
| `/api/coach/analyze` | POST | User | Analyze week |
| `/api/coach/chat` | POST | User | Q&A with coach |
| `/api/coach/grocky` | POST | User | Grocky review/chat |
| `/api/coach/runs` | GET | User | Get runs |
| `/api/coach/runs` | POST | User | Add run manually |
| `/api/coach/profile` | GET/PUT | User | Athlete profile |
| **Strava API** |
| `/api/strava/auth` | GET | User | Start Strava OAuth |
| `/api/strava/callback` | GET | - | OAuth callback |
| `/api/strava/sync` | POST | User | Sync runs |
| **Blog API** |
| `/api/blog/posts` | GET | Public | List published posts |
| `/api/blog/posts/[slug]` | GET | Public | Get single post |
| `/api/blog/categories` | GET | Public | List categories |
| `/api/blog/admin` | POST | Admin | Create post |
| `/api/blog/admin` | PUT | Admin | Update post |
| `/api/blog/admin` | DELETE | Admin | Delete post |
| `/api/blog/admin/categories` | POST | Admin | Create category |

---

## Security Considerations

1. **Authentication**: All `/coach/*` routes protected by NextAuth session
2. **API Routes**: Verify session in every API route
3. **Database**: User-scoped queries only (always filter by `userId`)
4. **Secrets**: Never expose API keys to client
5. **CORS**: Handled by Next.js API routes
6. **Rate Limiting**: Consider adding for AI endpoints

---

## Migration from Streamlit

### Data Migration Script

```typescript
// scripts/migrate-from-sqlite.ts
import Database from 'better-sqlite3'
import { prisma } from '@/lib/db/client'

async function migrate() {
  const sqlite = new Database('path/to/master_running_data.db')
  
  // Migrate runs
  const runs = sqlite.prepare('SELECT * FROM runs').all()
  for (const run of runs) {
    await prisma.run.create({
      data: {
        userId: 'YOUR_USER_ID', // Single user migration
        date: new Date(run.date),
        distanceKm: run.distance_km,
        durationMin: run.duration_min,
        avgHr: run.avg_hr,
        // ... map all fields
      }
    })
  }
  
  // Migrate athlete profile
  const profile = sqlite.prepare('SELECT * FROM athlete_profile').all()
  // ... similar migration
  
  console.log('Migration complete!')
}

migrate()
```

---

## Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1: Foundation | 2-3 days | Boilerplate + DB setup |
| Phase 2: CV Page | 2-3 days | Depends on design complexity |
| Phase 2.5: Blog System | 2-3 days | Mostly exists in boilerplate, connect to DB |
| Phase 3: Coach App UI | 4-5 days | All pages and components |
| Phase 4: Database & API | 2-3 days | Schema + CRUD |
| Phase 5: AI Integration | 3-4 days | Port prompts + test |
| Phase 6: Strava | 2-3 days | OAuth + sync |
| Phase 7: Deployment | 1-2 days | Deploy + test |
| **Total** | **18-26 days** | |

---

## Summary: What Stays, What's New

### From Boilerplate (KEEP)
- ✅ Glassmorphism design system
- ✅ Floating glass navbar
- ✅ Mobile hamburger menu
- ✅ Scroll-to-top button
- ✅ Dark/Light mode
- ✅ Blog system with TTS
- ✅ Shadcn/ui components
- ✅ Framer Motion animations
- ✅ NextAuth setup

### New Development
- 🆕 CV/Portfolio main page (design TBD)
- 🆕 Running coach app (`/coach/*`)
- 🆕 Database integration (PostgreSQL)
- 🆕 AI coach integration (OpenRouter)
- 🆕 Strava OAuth + sync
- 🆕 Blog admin panel
- 🆕 Blog database (replace static file)

---

## Notes for Developer

1. **Existing Code**: The Streamlit app code in `coach.py`, `coach_qa.py`, `coach_grocky.py` contains all the prompts and logic - port these to `lib/ai/`

2. **System Prompts**: The prompts are comprehensive - keep them as-is, just format for TypeScript

3. **Database Migration**: If migrating existing data, run the migration script before going live

4. **Testing AI**: Use OpenRouter playground to test prompts before implementing

5. **Mobile First**: The boilerplate is responsive - maintain this for coach app

6. **Error Handling**: Add proper error boundaries and loading states

