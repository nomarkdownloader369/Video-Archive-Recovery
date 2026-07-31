---
name: PervFlix setup
description: Key lessons from registering the PervFlix artifacts after a GitHub import, where the Replit artifact system had no knowledge of existing artifact.toml files.
---

## The problem
GitHub-imported projects have `artifact.toml` files on disk but no Replit artifact registrations. `listArtifacts()` returns empty. The proxy router (`router = "application"` in `.replit`) only routes to registered artifacts, so the dev domain returns 503.

## Fix sequence
1. Extract real source from the attached zip (the git import zip in `attached_assets/`) — NOT from a directory backup taken after `createArtifact` runs, which only contains the scaffold.
2. Remove `artifacts/<slug>/` directory, then call `createArtifact()` to get proper registration + managed workflow.
3. Overwrite the scaffold's src with real source files from the zip.
4. Kill any stale process holding the old port before restarting the managed workflow (`lsof -ti :<port> | xargs kill -9`).

## Vite proxy (required)
The pervflix frontend calls `/api/pf/*`. The API server runs on port 8080 (separate managed workflow). In dev, Vite must proxy `/api` → `http://localhost:8080` in `vite.config.ts`'s `server.proxy`. Without this, `/api` calls go nowhere.

**Why:** The Replit proxy routes `/api` to the api-server artifact at the edge, but Vite's own dev server doesn't know about that routing — it only sees its own port. The proxy bridges the gap in development.

## Ports
- `artifacts/pervflix: web` → port 22141 (assigned by createArtifact)
- `artifacts/api-server: API Server` → port 8080 (from artifact.toml)

## Real source location
The original source lives in `attached_assets/PervFlix-Recovery25-main_*.zip` → `PervFlix-Recovery25-main/artifacts/pervflix/src/`.
