# KariyalyAI

KariyalyAI is an AI-assisted career workspace for analysing jobs, tailoring applications, researching companies, writing outreach, and tracking applications.

## Current features

- Supabase email authentication and protected routes
- CV upload/text extraction, AI parsing, profile review and storage
- Candidate profile dashboard with skills cloud, experience timeline, work-authorisation details and user data deletion
- Job analysis with:
  - Visual match score meter, verdict, strengths and gaps
  - Work-authorisation guidance
  - UK sponsor-register lookup
- Tailor workspace:
  - CV summary and cover letter generation
  - Editing, copying, autosave and forced regeneration
- Research workspace:
  - Gemini search grounding with source links and recent news
  - Groq fallback when Gemini fails
  - About-text fallback with confidence and fallback messaging
- Outreach workspace:
  - Email and LinkedIn messages
  - Tone and follow-up controls
  - Email subject generation and copy action
- Application tracker:
  - Kanban board and list views with real-time search
  - Saved, Applied, Interview, Offer and Rejected columns
  - Manual applications and notes
  - Status changes, eight-second undo, history drawer and deletion
- Responsive application shell with desktop sidebar and mobile navigation
- Supabase Row Level Security for user-owned data

## UI and accessibility

- Accessible, executive design system with high-contrast typography, focus states and responsive layouts
- Standardised `AI-generated, please verify` label across all AI outputs

## Routes

| Route | Purpose |
|---|---|
| `/login` | Sign in |
| `/signup` | Create an account |
| `/onboarding` | Create a professional profile |
| `/app/profile` | Career workspace overview and profile dashboard |
| `/app/jobs/new` | Analyse a job |
| `/app/jobs/:id` | Match, Tailor, Research and Outreach tabs |
| `/app/tracker` | Application tracker |

## Tech stack

- React, TypeScript, Vite and React Router
- Netlify Functions
- Supabase Auth and PostgreSQL
- Zod schemas shared between frontend and functions
- Google Gemini as the primary AI provider
- Groq as the general AI fallback provider
- Tailwind CSS and Lucide React

## Setup

### Prerequisites

- Node.js and npm
- Supabase project with migrations applied
- Netlify CLI
- Gemini API access
- Groq API access for AI fallback requests

Install dependencies:

```bash
npm install
```

### Environment variables

Keep server-only credentials out of `VITE_` variables and do not commit local environment files.

Browser/local variables:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_MOCK_AI=false
```

Netlify function variables:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
GROUNDING_ENABLED=true
GLOBAL_DAILY_AI_CAP=150
GLOBAL_DAILY_GROUNDED_CAP=50
```

Optional tuning variables:

```env
REQUEST_BUDGET_MS=9000
GEMINI_TIMEOUT_MS=5000
GROQ_TIMEOUT_MS=4000
GROUNDING_TIMEOUT_MS=6000
STRUCTURE_TIMEOUT_MS=3500
```

Netlify synchronous functions stop after about 10 seconds on the default plan. `REQUEST_BUDGET_MS` is the total time one request may spend calling AI providers, and every provider call is cut short to fit inside it. When Gemini times out, cannot be reached or returns an HTTP error, standard tasks fall back to Groq. `GEMINI_TIMEOUT_MS` applies only when `GROQ_API_KEY` is set; without a fallback provider, Gemini may use the whole request budget. Raise these values only if the site's function time limit is higher.

`GROQ_API_KEY` is used only on the server when Gemini fails for a standard AI task. For `company_brief`, Gemini still handles search grounding first. When a Groq key is set, the Groq fallback brief is started at the same time as the search, so a fallback is ready if the search fails and the search can use the whole request budget. Groq can generate the non-grounded fallback, but cannot provide grounded news or source links.

### Run locally

For frontend-only work:

```bash
npm run dev
```

For the frontend and Netlify Functions together:

```bash
npx netlify dev
```

The local app is normally available at `http://localhost:8888` through Netlify Dev, or `http://localhost:5173` through Vite.

## Validation

```bash
npm run build
npm run lint
```

The build may report a bundle-size warning; it currently completes successfully.

## Database

Apply migrations in order:

1. `supabase/migrations/001_init.sql`
2. `supabase/migrations/002_ai_cache.sql`
3. `supabase/migrations/003_grounding_and_global_cap.sql`

The migrations define profiles, jobs, matches, generated outputs, applications, application history, AI usage, cache, sponsor data, RLS policies and supporting RPCs/triggers.

## Remaining verification

The main functionality is implemented. Remaining work is verification and polish:


- Test Gemini failure, grounding disabled, Groq fallback and shared-cap responses.
- Add automated unit/component tests where needed.
- Run the representative CV and job-description test set before release.

AI-generated content is advisory. Users should verify application content, company research and immigration information independently.
