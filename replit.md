# PervFlix

A cinematic adult video streaming platform that aggregates 25,000+ studio-quality videos from curated sources, served through a custom dark-themed React interface with search, categories, performer pages, and a personal watchlist.

## Architecture

This is a pnpm monorepo with two registered artifacts:

| Artifact | Path | Preview |
|---|---|---|
| PervFlix (React frontend) | `artifacts/pervflix/` | `/` |
| API Server (Express backend) | `artifacts/api-server/` | `/api/` |

### Shared libraries (under `lib/`)
- `lib/db` — Drizzle ORM schema + PostgreSQL client. Schema: `pf_videos` table.
- `lib/api-spec` — OpenAPI spec + Orval codegen (generates React Query hooks & Zod schemas)
- `lib/api-client-react` — Generated React Query hooks (consumed by the frontend)
- `lib/api-zod` — Generated Zod schemas (consumed by the API server)

## How to run

Both workflows start automatically. To restart manually:
- Frontend: WorkflowsRestart `artifacts/pervflix: web`
- API Server: WorkflowsRestart `artifacts/api-server: web`

**After schema changes**, run: `pnpm --filter @workspace/db run push`

**After OpenAPI spec changes**, run: `pnpm --filter @workspace/api-spec run codegen`

## Database

Uses Replit's built-in PostgreSQL. `DATABASE_URL` is set automatically.

On first boot with an empty database, the API server auto-restores ~4,900+ videos from `artifacts/api-server/backup.json`. The scraper then fills in more content in the background.

## Key files

- `artifacts/pervflix/src/` — React frontend (TanStack Router, Framer Motion, shadcn/ui)
- `artifacts/api-server/src/index.ts` — Express entry point, scraper bootstrap, DB diagnostics
- `artifacts/api-server/src/lib/scraper.ts` — HQporner / GalaxyPorn / FXPornHD scrapers
- `artifacts/api-server/src/routes/` — API route handlers
- `artifacts/api-server/backup.json` — Video index backup (source of truth for initial data — do not delete)
- `lib/db/src/schema/videos.ts` — `pf_videos` table schema

## User preferences

- Keep the existing dark-theme aesthetic for any UI changes
