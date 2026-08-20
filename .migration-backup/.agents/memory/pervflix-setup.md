---
name: PervFlix setup
description: Artifact registration and workflow setup lessons for the PervFlix project imported from GitHub.
---

# PervFlix Setup Lessons

## Artifact registration on GitHub import

When a project is imported from GitHub with existing `artifacts/<slug>/.replit-artifact/artifact.toml` files, the artifacts are NOT automatically registered with Replit's system — `listArtifacts()` returns `[]`.

**Why:** `createArtifact` is the only registration path. Existing artifact directories on disk are invisible to the platform until registered.

**How to apply:** To register an existing artifact without losing its source:
1. Back up: `cp -r artifacts/<slug> /tmp/<slug>-backup`
2. Delete: `rm -rf artifacts/<slug>`
3. Register: `createArtifact({ artifactType, slug, previewPath, title })` — this creates a fresh scaffold AND registers it, creating managed workflows
4. Restore original files over the scaffold (excluding `node_modules` and `.replit-artifact`)
5. Run `pnpm install` to reconcile dependencies
6. Use `WorkflowsRestart` with the managed workflow name from `result.workflows`

## API proxy in vite.config.ts

The original pervflix vite.config.ts has a `/api` proxy to `localhost:8080`. When using managed artifact workflows, the Replit routing layer also handles `/api` → API server at the network level. The Vite proxy is still useful for local dev without the Replit layer, and does not conflict.

## backup.json is source of truth

`artifacts/api-server/backup.json` is the video index backup. On first boot with empty DB, it restores ~4,900+ rows automatically. Never delete it.

## Managed workflow names and lifecycle

- Frontend: `artifacts/pervflix: web`
- API server: `artifacts/api-server: web`
- Canvas/mockup: `artifacts/mockup-sandbox: Component Preview Server`

Artifact-owned workflows cannot be removed through the normal workflow removal
callback; they can be stopped, while the artifact registration remains.

**Why:** Replit owns the lifecycle of artifact services so their preview routing
and injected service configuration stay consistent.

**How to apply:** Remove legacy workflows from `.replit`, stop unused
artifact-owned services, and leave the active artifact workflows managed by
Replit.

## Validation and database startup

Run the root `pnpm run typecheck` rather than the API package check in isolation; the
root build first generates shared-library declarations required by API project
references.

**Why:** A clean import can have reachable PostgreSQL credentials but no `pf_videos`
table yet, which makes the API intentionally disable scraping at boot.

**How to apply:** After a fresh import or restored database, run
`pnpm --filter @workspace/db run push` before restarting the API artifact. This creates
the schema and allows the boot backfill to run.

## Restore-before-purge startup order

Any one-time database purge that is meant to remove bad restored rows must run after
the empty-database backup restore and before title repair or scraper backfill.

**Why:** Running the purge before restore sees an empty table and leaves malformed
backup rows in place; running it after title repair can erase the evidence needed to
identify rows for native re-scraping.

**How to apply:** Chain startup as restore → corruption purge → cleanup/repair →
stale-source purges → deduplication → scraper backfill.
