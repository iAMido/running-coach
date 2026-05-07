# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ido Mosseri's Personal Portfolio** - A professional portfolio website featuring an interactive CV with anchor navigation, a blog system with Text-to-Speech capabilities, and Google OAuth authentication. Built with Next.js 16, React 19, Bun, and TypeScript.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, NextAuth.js, Bun runtime

## Development Commands

### Core Development
```bash
bun run dev      # Start development server with Turbopack (hot reload)
bun run build    # Create production build - MUST run and fix errors before commit
bun run start    # Start production server
bun run lint     # Run ESLint
```

### Package Management (Bun preferred)
```bash
bun install              # Install dependencies (~1.5s vs npm's ~45s)
bun add <package>        # Add dependency
bun add -d <package>     # Add dev dependency
bunx <command>           # Execute package binary (like npx)
```

### shadcn/ui Component Installation
```bash
bunx shadcn@latest add <component-name>    # Add new UI component
bunx shadcn@latest add dialog toast table  # Add multiple components
```

### Authentication Setup
```bash
bunx openssl rand -base64 32    # Generate NEXTAUTH_SECRET
```

## Architecture Overview

### Next.js App Router Structure
This project uses the **App Router** (not Pages Router). Key patterns:

- **Server Components by default** - Most components are server-side unless marked with `'use client'`
- **Static Generation** - Blog posts use `generateStaticParams()` for build-time rendering
- **Dynamic Routes** - Blog articles at `/blog/[slug]` with static params
- **API Routes** - NextAuth at `/app/api/auth/[...nextauth]/route.ts`

### Directory Structure
```
app/
├── layout.tsx                    # Root layout with providers & metadata
├── page.tsx                      # CV homepage (client component)
├── providers.tsx                 # ThemeProvider + SessionProvider
├── globals.css                   # Tailwind + theme + CV styles
├── api/auth/[...nextauth]/       # NextAuth API routes
├── blog/
│   ├── page.tsx                  # Blog listing (client component)
│   ├── [slug]/page.tsx           # Article page (server component with SSG)
│   └── layout.tsx                # Blog section layout
├── caltrack/                     # CalTrack calorie tracking dashboard
│   ├── layout.tsx                # CalTrack layout with sidebar
│   ├── page.tsx                  # Overview: daily calories, macros, weight chart
│   ├── meals/page.tsx            # Meals list with add/edit/delete + AI analysis
│   ├── weight/page.tsx           # Weight log
│   └── foods/page.tsx            # Food database browser
├── coach/                        # AI Running Coach (protected)
│   ├── layout.tsx                # Protected layout with sidebar
│   ├── page.tsx                  # Dashboard
│   ├── log/page.tsx              # Log runs with feedback
│   ├── review/page.tsx           # Weekly review with AI analysis
│   ├── plan/page.tsx             # Training plan generation
│   ├── ask/page.tsx              # Ask Coach (Claude chat)
│   ├── grocky/page.tsx           # Grocky Balboa (Grok second opinion)
│   ├── strava/page.tsx           # Strava sync
│   ├── strava/callback/page.tsx  # Strava OAuth callback
│   └── settings/page.tsx         # User settings
└── profile/page.tsx              # Protected route (requires auth)

components/
├── cv/                           # CV components (client components)
│   ├── cv-navigation.tsx         # Anchor-based navigation with mobile menu
│   ├── cv-hero.tsx               # Hero with contact info
│   ├── cv-about.tsx              # About section
│   ├── cv-skills.tsx             # Skills grid
│   ├── cv-experience.tsx         # Work history timeline
│   ├── cv-education.tsx          # Education timeline
│   ├── cv-contact.tsx            # Contact section
│   └── cv-sidebar.tsx            # Fixed sidebar (desktop only)
├── blog/
│   └── article-content.tsx       # Article with TTS player (client component)
├── coach/
│   └── sidebar.tsx               # Coach section sidebar navigation
├── layout/
│   ├── navbar.tsx                # Site navbar (for blog/profile/coach)
│   └── footer.tsx                # Site footer
└── ui/                           # shadcn/ui components
    ├── button.tsx                # CVA-based button variants
    ├── mode-toggle.tsx           # Dark/light theme toggle
    └── [other components]...

lib/
├── cv-data.ts                    # CV content data (TypeScript interfaces)
├── blog.ts                       # Blog data layer (getAllPosts, getPostBySlug)
├── utils.ts                      # Utility functions (cn for className merging)
├── db/                           # Database layer (Supabase)
│   ├── supabase.ts               # Supabase client (RunCoach)
│   ├── supabase-caltrack.ts      # Supabase client (CalTrack — separate project)
│   ├── caltrack-types.ts         # CalTrack TypeScript types (meals, items, profile, etc.)
│   ├── types.ts                  # TypeScript types for all tables
│   ├── runs.ts                   # Runs CRUD operations
│   ├── plans.ts                  # Training plans CRUD
│   ├── profile.ts                # Athlete profile CRUD
│   └── feedback.ts               # Run feedback & weekly summaries
├── ai/                           # AI integration (OpenRouter)
│   ├── openrouter.ts             # OpenRouter API client
│   ├── coach-prompts.ts          # Claude coach system prompts
│   └── grocky-prompts.ts         # Grok (Grocky) system prompts
└── utils/                        # Utility functions
    ├── trimp.ts                  # Training load calculation
    ├── pace.ts                   # Pace formatting/conversion
    └── run-classifier.ts         # Run type classification
```

### Path Aliases
All imports use the `@/` prefix mapped to the root directory:
```typescript
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { cvData } from "@/lib/cv-data"
```

## Key Technical Patterns

### CV Homepage with Anchor Navigation
**File:** `app/page.tsx`

- Client component with anchor-based navigation (#about, #skills, #experience, #education, #contact)
- Smooth scroll behavior implemented in `globals.css`
- Two-column layout on desktop (content + fixed sidebar), single-column on mobile
- Fixed header on mobile with hamburger menu, inline header on desktop
- CV sections use scroll-margin-top for proper anchor offset

**Key Files:**
- `components/cv/cv-navigation.tsx` - Navigation with smooth scroll to sections
- `lib/cv-data.ts` - All CV content in TypeScript data structure
- `app/globals.css` - CV-specific styles starting at line 480

### CV Data Structure
**File:** `lib/cv-data.ts`

```typescript
export interface CVData {
  personal: PersonalInfo
  about: string
  skills: Skill[]
  experience: WorkExperience[]
  education: Education[]
  contact: ContactInfo
}

export const cvData: CVData = { /* All CV content */ }
```

To update CV content, edit this single file. All CV components automatically read from `cvData`.

### Authentication with NextAuth.js
**File:** `app/api/auth/[...nextauth]/route.ts`

- Google OAuth provider configured
- Environment variables required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- Session available via `useSession()` hook in client components
- Protected routes check session and redirect to sign-in
- User profile accessible at `/profile` (requires authentication)

### Blog System
**Data Layer:** `lib/blog.ts`

```typescript
interface BlogPost {
  slug: string;              // URL identifier
  title: string;
  excerpt: string;           // Preview text
  content: string;           // Plain text for TTS
  contentHtml: string;       // HTML for rendering
  category: string;          // Engineering, Design, Framework
  date: string;
  readingTime: number;       // Minutes
  author: { name: string; avatar?: string; }
}

// Key functions:
getAllPosts()      // Returns all posts sorted by date (newest first)
getPostBySlug()    // Fetches single post by slug
getAllSlugs()      // Returns slugs for static generation
```

**Blog Pages:**
- **Listing** (`app/blog/page.tsx`): Client component with Framer Motion animations, 3-column grid
- **Article** (`app/blog/[slug]/page.tsx`): Server component with `generateStaticParams()` for SSG
- **Article Content** (`components/blog/article-content.tsx`): Client component with:
  - Reading progress bar (scroll-based)
  - Web Speech API TTS integration
  - Spotify-style audio player with voice selection and speed control (0.5x-2x)
  - Mobile-responsive with iOS safe-area insets

### Theme System
**Files:** `app/globals.css`, `app/providers.tsx`, `components/ui/mode-toggle.tsx`

- Built with `next-themes` library
- CSS custom properties for all colors in `:root` and `.dark`
- Automatic system preference detection
- Theme toggle component in navbar
- Supports light/dark mode with smooth transitions

**CV Color Scheme:**
```css
--cv-blue: #2563EB      /* Primary - sections, links */
--cv-green: #10B981     /* Accent - timeline markers */
--cv-slate: #64748B     /* Secondary - text */
```

### Styling Approach
- **Tailwind CSS 4** with CSS variables
- **shadcn/ui** components using Radix UI primitives + CVA (Class Variance Authority)
- **Mobile-first responsive** - All components support sm/md/lg breakpoints
- **Utility function** - `cn()` merges className strings with tailwind-merge
- **CV-specific styles** - Added at end of `globals.css` (line 480+)

### Client vs Server Components
**Server Components (default):**
- Layouts, metadata generation, data fetching
- Blog article pages with `generateMetadata()` and `generateStaticParams()`

**Client Components (require `'use client'`):**
- CV homepage and all CV components (for anchor navigation and interactivity)
- Interactive UI: navbar, theme toggle, blog listing with animations
- Components using hooks: useSession, useState, useEffect, useTheme
- TTS player with Web Speech API

## Environment Variables

Create `.env.local` from `.env.example`:
```bash
NEXTAUTH_SECRET=<generated-secret>        # bunx openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000        # Callback URL
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
```

**Google OAuth Setup:**
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create OAuth client ID (Web application)
3. Add redirect URI: `http://localhost:3000/api/auth/callback/google`
4. For production, add production URL to authorized redirects

## Common Development Tasks

### Updating CV Content
Edit `lib/cv-data.ts` - single source of truth for all CV data:
```typescript
export const cvData: CVData = {
  personal: { name, title, phone, email, location },
  about: "Professional summary...",
  skills: [{ category: "Category", items: ["skill1", "skill2"] }],
  experience: [{ position, company, duration, description }],
  education: [{ qualification, institution, year, note? }],
  contact: { phone, email, location, social: [] }
}
```

### Adding CV Sections
1. Add data to `lib/cv-data.ts`
2. Create component in `components/cv/`
3. Import and add to `app/page.tsx`
4. Add anchor link to `components/cv/cv-navigation.tsx`

### Adding New Blog Posts
Edit `lib/blog.ts` and add to the `posts` array:
```typescript
{
  slug: 'my-article',
  title: 'My Article Title',
  excerpt: 'Short preview...',
  content: 'Plain text content for TTS...',
  contentHtml: '<p>HTML content for rendering...</p>',
  category: 'Engineering',  // or 'Design', 'Framework'
  date: '2025-01-15',
  readingTime: 5,
  author: { name: 'Ido Mosseri' }
}
```

### Adding shadcn/ui Components
```bash
bunx shadcn@latest add <component>
# Example: bunx shadcn@latest add dialog
```
Components are installed to `components/ui/` and can be customized freely.

### Adding Authentication Providers
Edit `app/api/auth/[...nextauth]/route.ts`:
```typescript
import GithubProvider from "next-auth/providers/github"

providers: [
  GoogleProvider({ ... }),
  GithubProvider({
    clientId: process.env.GITHUB_ID!,
    clientSecret: process.env.GITHUB_SECRET!,
  }),
]
```

### Customizing CV Colors
Edit `app/globals.css` around line 587:
```css
:root {
  --cv-blue: #2563EB;      /* Primary color */
  --cv-green: #10B981;     /* Accent color */
  --cv-slate: #64748B;     /* Secondary color */
}
```

### Adding Remote Images
If you need to use images from external domains, add to `next.config.ts`:
```typescript
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'your-domain.com',
      pathname: '/**',
    },
  ],
}
```

## Important Notes

### Before Every Commit
1. **ALWAYS run `bun run build`** to check for TypeScript and build errors
2. Fix all errors before committing
3. Only then commit and push changes

### CV-Specific Conventions
- All CV content stored in `lib/cv-data.ts` - single source of truth
- CV components are client components (use `'use client'`)
- Anchor navigation uses `scrollIntoView({ behavior: 'smooth' })`
- Section IDs match navigation hrefs: #about, #skills, #experience, #education, #contact
- Mobile: Fixed header with hamburger menu
- Desktop: Inline header with horizontal navigation + fixed sidebar

### TypeScript Configuration
- **Strict mode enabled** - All code must be type-safe
- **Path alias** - Use `@/` prefix for imports from root
- **Target ES2017** - Modern JavaScript features available

### Component Conventions
- Use shadcn/ui components from `@/components/ui/` for consistency
- Client components need `'use client'` directive at the top
- Use `cn()` utility for merging className strings
- Follow mobile-first responsive design patterns

### Performance Considerations
- Blog posts are statically generated at build time (ISR not configured)
- CV page is client-side rendered for interactivity
- Images should use `next/image` component for optimization
- Remote image domains must be configured in `next.config.ts`
- Use React Server Components by default unless interactivity is required

### Accessibility
- All interactive elements have keyboard support
- Icon-only buttons include ARIA labels
- Color contrast meets WCAG AA standards
- Focus-visible styles for keyboard navigation
- Anchor navigation provides skip-to-content functionality

## Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import project in Vercel
3. Add environment variables (same as `.env.local`)
4. Update `NEXTAUTH_URL` to production URL
5. Add production URL to Google OAuth authorized redirects

### Build Verification
Always verify production build locally before deploying:
```bash
bun run build && bun run start
```
Test on `http://localhost:3000` to ensure everything works.

## Future Roadmap

> **Full Blueprint:** `C:\Users\ido\my_site\developer_blueprint.md`

### Project Vision
Transform this portfolio into a full-featured site with an AI Running Coach sub-app.

### Current Status (Phase 2 - DONE)
- ✅ CV/Portfolio homepage with anchor navigation
- ✅ Blog system with TTS (static posts in `lib/blog.ts`)
- ✅ NextAuth with Google OAuth
- ✅ Theme toggle (dark/light mode)
- ✅ Responsive design with mobile menu
- ✅ Footer with correct social links
- ✅ Scroll-to-top button (blue/green gradient)

### Pending Tasks
- ✅ ~~Update blog colors to match CV theme (blue/green instead of pink/orange)~~ - DONE

### Future Phases

#### Phase 2.5: Blog System Enhancement
- Connect blog to PostgreSQL database (Prisma)
- Add admin panel for blog CRUD
- Keep existing TTS player and glassmorphism cards

#### Phase 3: AI Running Coach (`/coach`)
Protected route with:
- Dashboard with stats
- Training plan generator
- Weekly review
- Ask Coach (Q&A with Claude via OpenRouter)
- Grocky Balboa (second opinion with Grok)
- Strava sync

**Components to create:**
```
app/coach/
├── layout.tsx          # Protected layout with sidebar
├── page.tsx            # Dashboard
├── plan/page.tsx       # Training plan
├── review/page.tsx     # Weekly review
├── ask/page.tsx        # Q&A chat
├── grocky/page.tsx     # Second opinion
├── sync/page.tsx       # Strava sync
└── settings/page.tsx   # User settings

components/coach/
├── sidebar.tsx
├── dashboard-stats.tsx
├── run-table.tsx
├── plan-display.tsx
├── chat-interface.tsx  # Reusable for Q&A and Grocky
└── strava-connect.tsx
```

#### Phase 4: Database & API
- PostgreSQL with Prisma ORM
- Tables: runs, training_plans, athlete_profile, weekly_feedback, strava_account
- Blog tables: blog_posts, blog_categories, blog_tags

#### Phase 5: AI Integration
- OpenRouter API client (`lib/ai/openrouter.ts`)
- Claude for main coach logic
- Grok for Grocky Balboa second opinion
- Port prompts from existing Streamlit app

#### Phase 6: Strava Integration
- OAuth flow for Strava connection
- Sync runs from Strava API
- Store in database with HR zone data

#### Phase 7: Deployment
- Vercel deployment
- Supabase/Neon for PostgreSQL
- Environment variables for all services

### Environment Variables (Future)
```bash
# Current
NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

# Future additions
DATABASE_URL="postgresql://..."
OPENROUTER_API_KEY="..."
STRAVA_CLIENT_ID="..."
STRAVA_CLIENT_SECRET="..."
```

### CalTrack API Endpoints (Active)
| Route | Description |
|-------|-------------|
| `/api/caltrack/overview` | GET daily summary, stats, weight chart |
| `/api/caltrack/meals` | GET meals list with ingredient names |
| `/api/caltrack/meals/add` | POST new meal with ingredients |
| `/api/caltrack/meals/edit` | PUT edit meal type/ingredients/recalculate |
| `/api/caltrack/meals/delete` | DELETE meal (cascades FK order) |
| `/api/caltrack/analyze` | POST AI food analysis (Hebrew → ingredients + nutrition) |
| `/api/caltrack/weight` | GET/POST weight logs |
| `/api/caltrack/foods` | GET food database |

**CalTrack uses a separate Supabase project** (`tlnqkxwlrewbtufnqiwi`) from RunCoach (`ucjsnpnlxklaadqolpkx`). Env vars: `NEXT_PUBLIC_CALTRACK_SUPABASE_URL` and `CALTRACK_SUPABASE_SERVICE_ROLE_KEY`.

### Other API Endpoints (Future)
| Route | Description |
|-------|-------------|
| `/api/coach/plan` | Training plan CRUD |
| `/api/coach/chat` | Q&A with Claude |
| `/api/coach/grocky` | Second opinion with Grok |
| `/api/coach/runs` | Run data CRUD |
| `/api/strava/*` | Strava OAuth & sync |
| `/api/blog/admin/*` | Blog CRUD (admin only) |

### Design Consistency
- **Primary color:** `#2563EB` (blue)
- **Accent color:** `#10B981` (green)
- **Gradient:** `linear-gradient(90deg, #2563EB, #10B981)`
- All new features should use this color scheme

## Repository Information

**Repository:** https://github.com/iAMido/my-site
**Author:** Ido Mosseri (idomosseri@gmail.com)
**License:** MIT
