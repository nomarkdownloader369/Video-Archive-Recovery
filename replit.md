# PervFlix

A cinematic adult video streaming platform that aggregates 25,000+ studio-quality videos from curated sources, served through a custom dark-themed React interface with search, categories, performer pages, and a personal watchlist.

## Stack

- **Frontend**: React + Vite + TanStack Router + Tailwind CSS (`artifacts/pervflix`)
- **Backend**: Express.js API server with esbuild bundling (`artifacts/api-server`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **API contract**: OpenAPI → Orval codegen (`lib/api-spec`, `lib/api-client-react`, `lib/api-zod`)
- **Package manager**: pnpm workspaces

## Running the project

Both services start automatically via managed artifact workflows:

- **Frontend** (`artifacts/pervflix: web`) — React app at `/`
- **API server** (`artifacts/api-server: web`) — Express API at `/api/`

To install dependencies: `pnpm install` (from workspace root)

To push DB schema: `pnpm --filter @workspace/db run push`

## Key files

- `artifacts/pervflix/src/` — React frontend source
- `artifacts/api-server/src/` — Express server source (routes, middlewares, scrapers)
- `artifacts/api-server/backup.json` — Video index backup (~6,000 rows); auto-restored on empty DB startup
- `lib/db/src/schema/videos.ts` — Drizzle schema for `pf_videos` table
- `lib/api-spec/openapi.yaml` — OpenAPI spec (run codegen after changes)

## Notes

- On first boot with empty DB, the server auto-restores from `backup.json` then begins scraping
- Scraping runs every 4 hours (HQporner studios, keywords, performers, GalaxyPorn)
- `backup.json` is refreshed every 15 minutes while running — do not delete it
