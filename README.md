# Running Coach - AI-Powered Training Assistant

An intelligent running coach application with AI-powered training plans, run analysis, and personalized coaching. Features Strava integration, dual AI coaches (Claude & Grok), and comprehensive training tracking.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?style=for-the-badge&logo=tailwind-css)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase)

## Features

### AI Running Coach
- **Smart Dashboard** - Track runs, distance, weekly stats, and training progress
- **Training Plan Generator** - AI-generated personalized training plans based on your goals
- **Run Logging** - Log runs with detailed feedback and AI analysis
- **Weekly Review** - AI-powered weekly training analysis and recommendations
- **Ask Coach** - Chat with Claude AI for personalized running advice
- **Grocky Balboa** - Get a second opinion from Grok AI (your tough-love coach)
- **Strava Sync** - Connect your Strava account to automatically import runs

### Additional Features
- **Interactive CV** - Professional portfolio with anchor navigation
- **Blog System** - Articles with Text-to-Speech player
- **Google OAuth** - Secure authentication
- **Dark/Light Mode** - System-aware theme switching
- **Responsive Design** - Mobile-first, works on all devices

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Runtime | Bun |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | Shadcn/ui |
| Database | Supabase (PostgreSQL) |
| AI | OpenRouter (Claude, Grok) |
| Authentication | NextAuth.js |
| Animations | Framer Motion |

## Quick Start

### Prerequisites
- [Bun](https://bun.sh/) installed (or Node.js 18+)
- Supabase account for database
- OpenRouter API key for AI features
- (Optional) Strava API credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/iAMido/running-coach.git
cd running-coach

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local

# Start development server
bun run dev
```

Visit `http://localhost:3000` to see the application.

### Environment Variables

Create a `.env.local` file:

```env
# Authentication
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Database (Supabase)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# AI (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-api-key

# Strava (Optional)
STRAVA_CLIENT_ID=your-strava-client-id
STRAVA_CLIENT_SECRET=your-strava-client-secret
```

## Project Structure

```
running-coach/
├── app/
│   ├── page.tsx                    # Homepage (CV)
│   ├── blog/                       # Blog system
│   ├── coach/                      # AI Running Coach (protected)
│   │   ├── page.tsx                # Dashboard
│   │   ├── log/                    # Log runs
│   │   ├── plan/                   # Training plans
│   │   ├── review/                 # Weekly review
│   │   ├── ask/                    # Ask Coach (Claude)
│   │   ├── grocky/                 # Grocky Balboa (Grok)
│   │   ├── strava/                 # Strava integration
│   │   └── settings/               # User settings
│   └── api/                        # API routes
├── components/
│   ├── coach/                      # Coach UI components
│   ├── cv/                         # CV components
│   ├── blog/                       # Blog components
│   └── ui/                         # Shadcn/ui components
├── lib/
│   ├── ai/                         # AI integration
│   │   ├── openrouter.ts           # OpenRouter client
│   │   ├── coach-prompts.ts        # Claude prompts
│   │   └── grocky-prompts.ts       # Grok prompts
│   ├── db/                         # Database layer
│   │   ├── supabase.ts             # Supabase client
│   │   ├── runs.ts                 # Runs CRUD
│   │   ├── plans.ts                # Training plans
│   │   └── profile.ts              # Athlete profile
│   └── utils/                      # Utilities
└── docs/                           # Documentation
```

## Available Scripts

```bash
bun run dev      # Start development server
bun run build    # Create production build
bun run start    # Start production server
bun run lint     # Run ESLint
```

## Coach Features

### Dashboard
Track your running metrics at a glance:
- Total runs and distance
- Weekly mileage and trends
- Active training plan progress
- Recent activity feed

### Training Plans
AI-generated training plans tailored to your:
- Current fitness level
- Goal race distance
- Target completion time
- Available training days

### Ask Coach (Claude)
Get personalized advice on:
- Training questions
- Recovery strategies
- Race preparation
- Injury prevention

### Grocky Balboa (Grok)
Your tough-love second opinion coach:
- No-nonsense training feedback
- Reality checks on your goals
- Motivational push when needed

### Strava Integration
- One-click Strava connection
- Automatic run imports
- Heart rate zone analysis
- Training load calculation

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables
4. Deploy

### Database Setup (Supabase)

1. Create a new Supabase project
2. Run migrations from `docs/` directory
3. Copy connection details to `.env.local`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.

## Author

**Ido Mosseri**
- GitHub: [@iAMido](https://github.com/iAMido)
- LinkedIn: [idomosseri](https://www.linkedin.com/in/idomosseri/)
