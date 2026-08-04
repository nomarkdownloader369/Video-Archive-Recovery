# PervFlix

A cinematic adult video streaming platform that aggregates studio-quality videos from curated sources, served through a dark-themed React interface.

## Architecture

**Monorepo** — pnpm workspaces with three artifacts and shared libraries.

### Artifacts
| Artifact | Path | Preview | Description |
|---|---|---|---|
| PervFlix Frontend | `artifacts/pervflix/` | `/` | React + Vite dark-themed streaming UI |
| API Server | `artifacts/api-server/` | `/api/` | Express server — video index, scraping, DB |
| Canvas (mockup sandbox) | `artifacts/mockup-sandbox/` | `/__mockup/` | Component prototyping sandbox |

### Shared Libraries
| Package | Path | Purpose |
|---|---|---|
| `@workspace/db` | `lib/db/` | Drizzle ORM + PostgreSQL schema (`pf_videos` table) |
| `@workspace/api-zod` | `lib/api-zod/` | Zod schemas (generated via codegen) |
| `@workspace/api-client-react` | `lib/api-client-react/` | React Query hooks (generated via codegen) |
| `@workspace/api-spec` | `lib/api-spec/` | OpenAPI spec (`openapi.yaml`) + orval codegen config |

## Running the Project

Dependencies: `pnpm install`

Workflows (managed automatically):
- **`artifacts/pervflix: web`** — Frontend dev server (PORT 22141)
- **`artifacts/api-server: web`** — Express API server (PORT 22729)
- **`artifacts/mockup-sandbox: Component Preview Server`** — Canvas sandbox (PORT 23636)

## Database

Uses Replit's built-in PostgreSQL. Schema: `lib/db/src/schema/videos.ts`

Push schema changes: `pnpm --filter @workspace/db run push`

`artifacts/api-server/backup.json` — video index backup (~6,000+ rows). Auto-restores on empty DB at startup. **Do not delete.**

## API

Base path: `/api/`  
Health check: `GET /api/healthz`  
OpenAPI spec: `lib/api-spec/openapi.yaml`  
Codegen: `pnpm --filter @workspace/api-spec run codegen`

## Key Notes

- The API server scrapes HQporner, GalaxyPorn, and FXPornHD on a 4-hour autopilot schedule
- The frontend proxies `/api` requests to the Express server via artifact routing
- `SESSION_SECRET` env var required for session middleware

## User Preferences

- Keep the existing project structure — do not restructure or migrate
