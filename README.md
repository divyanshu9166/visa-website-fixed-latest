# US Visa Tracker

USCIS processing times, Visa Bulletin priority dates, appointment wait times,
and community case trackers — built on **Astro 6 + Tailwind CSS v4**, deployed
as static HTML + Cloudflare Pages Functions on **Cloudflare Pages** (free
tier), with **Prisma Postgres** as the edge-compatible database backend.

---

## Architecture

```
Cloudflare Pages (free plan)
├── /dist/**            → static HTML/CSS/JS  (Astro build output)
└── /functions/**       → Cloudflare Pages Functions  (tiny Workers at /api/*)
      └── Prisma Client → Prisma Postgres (managed, connection-pooled Postgres)
```

**No separate server to host or pay for.** The static site is global CDN.
The API Functions are serverless Workers — zero cold start, free within
Cloudflare's limits (100,000 requests/day free), and the same deploy as the
static site. Prisma Postgres handles connection pooling at the edge so there
is no "sleeping database" and no reconnect lag.

---

## ⚠️ This repo ships with seed data

`uscis.gov` and `travel.state.gov` can block sandboxed/CI environments, so
the repo ships with clearly-labeled placeholder data. **Before going live:**

```bash
npm run data:fetch        # pulls real USCIS + State Dept data
```

The fetchers fall back to seed data automatically if a live call fails, so
the build always succeeds. See `scripts/lib/*.mjs` for the real API URLs.

---

## Setup Guide

### Step 1 — Create a Prisma Postgres database

1. Go to **[console.prisma.io](https://console.prisma.io)** → sign up (free)
2. Click **New project** → **New database** → pick the region closest to your users
3. Once created, click **Connect** → copy the **`DATABASE_URL`**
   It looks like:
   ```
   prisma+postgres://accelerate.prisma-data.net/?api_key=eyJ...
   ```

> **Why Prisma Postgres?** It includes Prisma Accelerate (connection pooling +
> caching), which means the Cloudflare Workers edge runtime can open a
> database connection without the usual "too many connections" problem. The
> free tier gives you 6 GB storage, 10 GB monthly data transfer, and up to
> 100 concurrent connections — more than enough for production.

---

### Step 2 — Push the schema to your database

On your local machine (not in this repo's sandbox — you need real internet
access to reach Prisma Postgres):

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/visa-website.git
cd visa-website
npm install

# Set your local dev secret (do NOT commit this file)
cp .dev.vars.example .dev.vars
# Edit .dev.vars and paste your DATABASE_URL from Step 1

# Generate the Prisma Client (creates node_modules/.prisma/client/)
npx prisma generate

# Push the schema to Prisma Postgres (creates all tables)
npx prisma db push
```

You should see output like:
```
✓ Generated Prisma Client
✓ Your database is now in sync with your Prisma schema.
```

---

### Step 3 — Deploy to Cloudflare Pages

#### Option A — Git-connected deploy (recommended)

1. Push your repo to GitHub
2. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → **Pages** → **Create a project** → **Connect to Git**
3. Select your repo, then set:
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Go to **Settings → Environment Variables** and add:
   ```
   DATABASE_URL = prisma+postgres://accelerate.prisma-data.net/?api_key=eyJ...
   ```
   Add it for both **Production** and **Preview** environments.
5. Click **Save and Deploy**

Cloudflare automatically detects the `functions/` directory and deploys those
as Pages Functions alongside the static site. No extra config needed.

#### Option B — Manual deploy via CLI

```bash
# Install Wrangler if you haven't already
npm install -g wrangler
wrangler login

# Build and deploy
npm run deploy
```

Then set the `DATABASE_URL` secret:
```bash
wrangler pages secret put DATABASE_URL --project-name visa-website
# Paste your prisma+postgres://... URL when prompted
```

---

### Step 4 — Local full-stack development

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your DATABASE_URL

npm run dev:full
# Opens http://localhost:8788 with both the static site AND Pages Functions
# (login, register, trackers API all work locally this way)
```

The `npm run dev` command (plain Astro dev server) also works for frontend-only
work — auth/tracker API calls will fail gracefully and show the "not connected"
banner, which is fine for working on UI changes.

---

## Daily data refresh (keeping USCIS data current)

A GitHub Actions workflow at `.github/workflows/data-refresh.yml` runs daily
at 10:00 UTC, fetches fresh USCIS/State Dept data, commits the updated JSON
files, and triggers a Cloudflare Pages rebuild.

To enable the auto-rebuild trigger:
1. In your Cloudflare Pages project → **Settings → Builds & deployments → Deploy hooks**
2. Create a hook (e.g. "GitHub Actions daily refresh")
3. Copy the hook URL → add it as a GitHub repo secret named `CF_DEPLOY_HOOK`

---

## Commands

| Command | Action |
|:--------|:-------|
| `npm install` | Install dependencies |
| `npm run dev` | Astro dev server at `localhost:4321` (frontend only) |
| `npm run dev:full` | Full-stack local dev via Wrangler at `localhost:8788` |
| `npx prisma generate` | Generate Prisma Client after schema changes |
| `npx prisma db push` | Push schema to Prisma Postgres |
| `npx prisma studio` | Open Prisma Studio (visual DB browser) |
| `npm run data:fetch` | Refresh USCIS/State Dept data from live sources |
| `node scripts/fetch-data.mjs --seed-only` | Regenerate seed data, no network |
| `npm run build` | Type-check + build to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Build + deploy via Wrangler CLI |

---

## Before going to production checklist

- [x] `astro.config.mjs` — site set to `https://easyvisacheck.com`
- [x] `public/robots.txt` — sitemap URL updated to match site URL
- [ ] Run `npx prisma db push` from your local machine against the real Prisma Postgres DB
- [ ] Run `npm run data:fetch` locally to seed with live USCIS data before first deploy
- [ ] Set `DATABASE_URL` in Cloudflare Pages environment variables
- [ ] (Optional) Add `CF_DEPLOY_HOOK` GitHub secret for daily auto-refresh

---

## Project structure

```
/
├── .github/workflows/data-refresh.yml   # daily cron fetch + redeploy
├── .dev.vars.example                    # copy to .dev.vars for local dev
├── wrangler.toml                        # Cloudflare Pages / Workers config
├── prisma/
│   └── schema.prisma                    # DB schema: users, sessions, 6 tracker tables
├── functions/                           # Cloudflare Pages Functions (serverless API)
│   ├── _lib/
│   │   ├── prisma.ts                    # Prisma Client getter (cached per isolate)
│   │   ├── auth.ts                      # PBKDF2 password hashing, session cookies
│   │   ├── currentUser.ts               # session resolver + safeHandler wrapper
│   │   └── trackerTables.ts             # allow-listed fields per tracker table
│   └── api/
│       ├── auth/
│       │   ├── register.ts              # POST /api/auth/register
│       │   ├── login.ts                 # POST /api/auth/login
│       │   ├── logout.ts                # POST /api/auth/logout
│       │   └── session.ts               # GET  /api/auth/session
│       └── trackers/[table]/
│           ├── index.ts                 # GET (public list) + POST (create, auth required)
│           ├── mine.ts                  # GET /api/trackers/{table}/mine (auth required)
│           └── [id].ts                  # DELETE /api/trackers/{table}/{id} (owner only)
├── scripts/
│   ├── fetch-data.mjs                   # orchestrator
│   └── lib/
│       ├── formsConfig.mjs              # master list of forms/service centers/countries
│       ├── processingTimes.mjs          # USCIS API fetcher + seed fallback
│       ├── visaBulletin.mjs             # State Dept scraper + seed fallback
│       └── waitTimes.mjs                # wait-times XML fetcher + seed fallback
├── src/
│   ├── content.config.ts                # Zod schemas (4 content collections)
│   ├── content/
│   │   ├── processingTimes/             # 16 form JSON files (H-1B, I-140, I-485…)
│   │   ├── visaBulletin/                # 720 month×category×country JSON files
│   │   ├── appointmentWaitTimes/        # 30 country JSON files
│   │   └── uscisQuarterlyStats/         # quarterly volume JSON files
│   ├── lib/
│   │   ├── auth.ts                      # browser-side fetch helpers (calls /api/auth/*)
│   │   └── trackers.ts                  # tracker registry + demo data generator
│   ├── components/
│   │   ├── trackers/                    # CommunityStats, CommunityTrackerTable, AddCaseForm, LiveDataSync
│   │   └── …                            # Breadcrumb, FAQAccordion, charts, ReceiptDatePredictor…
│   ├── layouts/
│   │   ├── Layout.astro                 # site shell: nav, footer, mobile menu
│   │   └── TrackerPageLayout.astro      # shared wrapper for all 6 tracker pages
│   └── pages/
│       ├── index.astro                  # homepage with live search
│       ├── login.astro / register.astro / dashboard.astro
│       ├── uscis-processing-times/      # hub + [visaSlug] dynamic pages
│       ├── green-card/
│       │   ├── visa-bulletin/           # hub + [country] pages + i485-tracker
│       │   └── priority-date-calculator.astro
│       ├── us-visa-appointment-wait-times/  # hub + [country] pages
│       ├── uscis-trackers/              # H-1B tracker
│       ├── trackers/                    # dropbox, reschedule, emergency trackers
│       └── us-visa-trackers/            # 221(g) tracker
└── package.json
```

---

Not affiliated with USCIS, DHS, or the U.S. Department of State.
