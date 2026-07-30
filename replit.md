# PervFlix

A cinematic theater for full-length studio releases — curated, high-fidelity, and free. Aggregates 25,000+ videos scraped from HQporner and FamilyPornHD, filtered by a strict studio/taboo whitelist, and served through a custom streaming interface.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/pervflix run dev` — run the frontend (port 22141)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (runtime-managed by Replit)

## Stack

- pnpm workspaces, Node.js, TypeScript
- **Frontend:** React + Vite 7 + Tailwind CSS v4 + TanStack Router
- **Backend:** Node.js + Express 5 (`artifacts/api-server`)
- **DB:** PostgreSQL + Drizzle ORM (`lib/db`)
- **Scraper:** Cheerio-based (`artifacts/api-server/src/lib/scraper.ts`)

## Where things live

- `artifacts/pervflix/src/routes/` — all page routes (TanStack Router file-based)
- `artifacts/pervflix/src/lib/api.ts` — API client (calls `/api/pf/*`)
- `artifacts/api-server/src/routes/videos.ts` — all `/api/pf/*` endpoints
- `artifacts/api-server/src/lib/scraper.ts` — HQporner + FamilyPornHD scraper
- `artifacts/api-server/src/index.ts` — server boot, backup restore, autopilot scheduler
- `artifacts/api-server/backup.json` — full video index backup (auto-refreshed every 15 min)
- `lib/db/src/schema/videos.ts` — `pf_videos` Drizzle table definition

## Design System & Brand Rules

- **Background:** `#000000` (absolute OLED black everywhere)
- **Primary/accent:** `#E60000` (vibrant crimson red)
- **Logo:** "PERV" bold white + "FLIX" bold red → `PERVFLIX`
- **Video card badges:** `rounded-full` black capsules with pulsing red neon dot; duration as "FULL • [Duration]"
- **Watch page quality badge:** Dynamic — "ULTRA" for 4K, "HD" for 1080p
- **Watchlist:** "My Watchlist" with red heart icon — no Arabic text
- **Mobile viewport:** Locked `maximum-scale=1`; `overflow-x: hidden !important` on html/body/#root

## Architecture decisions

- Backup/restore: On empty DB boot, `backup.json` is restored in 200-row chunks via `onConflictDoNothing()`. Auto-saves every 15 minutes.
- Categories: 39 curated taxonomy + `CATEGORY_ALIASES` synonym engine deduplicates covers in-memory per request.
- Performers: 33-item whitelist; videos tagged via `scrapeByPerformers()` unlimited-page crawl.
- Autopilot: `scrapeLatest(3)` + `scrapeFamilyPornHD(3)` every 4 hours; heartbeat self-ping every 2 minutes while scraping.
- Scraper filters: Only studio-whitelisted OR taboo-keyword-matching videos are kept.

## Product

- `/` — Homepage: hero slider, video grid with sort/filter, trending searches, FAQ
- `/browse/pornstars` — 33 whitelisted performers with video counts
- `/browse/pornstar/$name` — individual performer page
- `/browse/categories` — 39 curated categories with dedup'd covers
- `/video/$slug` — Watch page with embedded player, dynamic quality badge, related videos
- `/watchlist` — Local "My Watchlist" saved to localStorage

## User preferences

_Populate as needed._

## Gotchas

- `backup.json` is the source of truth for video data on a fresh workspace. Never delete it.
- After schema changes run `pnpm --filter @workspace/db run push` to sync the DB.
- The API server builds before starting (esbuild CJS bundle); edits require workflow restart.
- `@tanstack/react-router` is not in the pnpm catalog — declared directly in `artifacts/pervflix/package.json`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
