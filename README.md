# Ido Mosseri - Personal Portfolio & CV

Personal portfolio website featuring an interactive CV, professional blog, and project showcase. Built with Next.js 16, Bun, and TypeScript.

![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)
![Bun](https://img.shields.io/badge/Bun-Runtime-orange?style=for-the-badge&logo=bun)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?style=for-the-badge&logo=tailwind-css)

## Features

### Interactive CV
- **Anchor-based navigation** - Smooth scroll to About, Skills, Experience, Education, and Contact sections
- **Responsive design** - Two-column layout on desktop, single-column on mobile
- **Fixed sidebar** - Profile image and quick stats (desktop only)
- **Mobile-friendly** - Fixed header with hamburger menu
- **Download CV** - Direct PDF download functionality
- **Dark/Light mode** - Theme toggle with system preference detection
- **Print-optimized** - Clean print styles for CV generation

### Professional Blog
- **Blog system** with Text-to-Speech (TTS) player
- **Reading progress bar** - Track article progress as you scroll
- **Spotify-style audio player** - Listen to articles with playback controls
- **Voice selection** - Choose from available system voices
- **Speed control** - Adjust playback speed (0.5x - 2x)
- **Category tags** - Color-coded article categories
- **Reading time estimates** - Automatic calculation

### Technical Features
- **Next.js 16** - Latest App Router with React Server Components
- **React 19** - Newest React features and performance improvements
- **Bun runtime** - 30x faster package installation
- **TypeScript 5** - Full type safety with strict mode
- **Tailwind CSS 4** - Modern utility-first styling
- **Shadcn/ui** - Beautiful, accessible components
- **NextAuth.js** - Google OAuth authentication
- **Framer Motion** - Smooth animations
- **Dark/Light mode** - System-aware theme switching

## Quick Start

### Prerequisites
- [Bun](https://bun.sh/) installed (or Node.js 18+)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/iAMido/my-site.git
cd my-site

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local

# Start development server
bun run dev
```

Visit `http://localhost:3000` to see your portfolio.

### Environment Variables

Create a `.env.local` file with:

```env
NEXTAUTH_SECRET=your-secret-here  # Generate with: bunx openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Google OAuth Setup (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth client ID (Web application)
3. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy credentials to `.env.local`

## Project Structure

```
my-site/
├── app/
│   ├── page.tsx                   # CV homepage
│   ├── blog/                      # Blog system
│   ├── profile/                   # Protected profile page
│   └── api/auth/[...nextauth]/    # Authentication
├── components/
│   ├── cv/                        # CV components
│   │   ├── cv-navigation.tsx      # Anchor navigation
│   │   ├── cv-hero.tsx            # Hero section
│   │   ├── cv-about.tsx           # About section
│   │   ├── cv-skills.tsx          # Skills grid
│   │   ├── cv-experience.tsx      # Work history
│   │   ├── cv-education.tsx       # Education timeline
│   │   ├── cv-contact.tsx         # Contact info
│   │   └── cv-sidebar.tsx         # Profile sidebar
│   ├── blog/                      # Blog components
│   ├── layout/                    # Layout components
│   └── ui/                        # Shadcn/ui components
├── lib/
│   ├── cv-data.ts                 # CV content data
│   ├── blog.ts                    # Blog posts data
│   └── utils.ts                   # Utility functions
└── public/
    └── cv.pdf                     # Downloadable CV
```

## Customization

### Update CV Content

Edit `lib/cv-data.ts` to update your personal information:

```typescript
export const cvData: CVData = {
  personal: {
    name: "Your Name",
    title: "Your Title",
    // ...
  },
  // Update about, skills, experience, education, contact
}
```

### Add Blog Posts

Edit `lib/blog.ts` to add new articles:

```typescript
{
  slug: 'my-article',
  title: 'My Article Title',
  content: 'Plain text for TTS...',
  contentHtml: '<p>HTML content...</p>',
  category: 'Engineering',
  // ...
}
```

### Customize Colors

Edit `app/globals.css` to change the color scheme:

```css
:root {
  --cv-blue: #2563EB;      /* Primary color */
  --cv-green: #10B981;     /* Accent color */
  --cv-slate: #64748B;     /* Secondary color */
}
```

## Available Scripts

```bash
bun run dev      # Start development server
bun run build    # Create production build
bun run start    # Start production server
bun run lint     # Run ESLint
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables
4. Deploy

### Other Platforms

Works on any platform that supports Next.js:
- Netlify
- Railway
- Render
- Docker

## Technologies Used

- **Framework**: Next.js 16.1.1
- **Runtime**: Bun
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **UI Components**: Shadcn/ui
- **Icons**: Lucide React
- **Authentication**: NextAuth.js
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod

## About

This is the personal portfolio website of **Ido Mosseri**, Technical SEO Lead with 10+ years of experience in technical SEO, content strategy, and web development.

**Contact:**
- Email: idomosseri@gmail.com
- Phone: 050-6790792
- Location: Kfar Saba, Israel
- LinkedIn: [linkedin.com/in/idomosseri](https://www.linkedin.com/in/idomosseri/)
- GitHub: [github.com/iAMido](https://github.com/iAMido)

## License

MIT © Ido Mosseri
