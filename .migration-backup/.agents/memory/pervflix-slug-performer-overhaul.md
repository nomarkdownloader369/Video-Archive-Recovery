---
name: PervFlix slug & performer overhaul
description: generateUnifiedSlug, structural purgeGarbageModels, removal of gp-/fx- source prefixes, cross-source slug-merge upsert.
---

## Decisions

### generateUnifiedSlug (scraper.ts)
Strips `[bracketed]` studio prefixes and `\b\d{2}\s\d{2}\s\d{2}\b` date stamps before slugifying.
Neither "fx-" nor "gp-" prefixes are added.
**Why:** Same video discovered by multiple sources must produce identical slugs so they merge instead of duplicating.

### Cross-source slug-merge upsert (upsertBatchWithViewUpdate fallback)
When an embed_url conflict triggers the slug-conflict fallback, use `onConflictDoUpdate` on `videosTable.slug` instead of `onConflictDoNothing`.
Merge: `tags = ARRAY(SELECT DISTINCT unnest(pf_videos.tags || excluded.tags))` and same for `pornstars`.
**Why:** Two sources indexing the same video should combine their metadata, not silently discard the second source's tags/performers.

### purgeGarbageModels (index.ts) — structural rules only, no word lists
Three rules, no GARBAGE_WORDS set:
1. `trimmed.split(/\s+/).length > 3` → sentence, not a name
2. `/\d/.test(trimmed)` → contains a digit
3. `/["""''!?,:.;@#$%^&*()\[\]{}<>\/\\|+=~`_]/.test(trimmed)` → contains punctuation
**Why:** Word blacklists cause false-positives and require constant maintenance. Structural rules are self-maintaining.

### Source identification after slug prefix removal
Old gp- prefix checks replaced with:
- `autoQualityRepair`: `like(videosTable.thumbnail_url, "%galaxyporn.net%")`
- `purgeUnlistedPerformers` GP trust: `thumbnail_url ILIKE '%galaxyporn.net%'`
**Why:** Slugs no longer carry source prefixes; thumbnail domain is the reliable stable identifier.

### autoPerformerRepair — Source B applies to ALL videos
Removed `isGp = video.slug.startsWith("gp-")` gate.
DB performer pool title-matching (Source B) now runs on ALL published videos.
**Why:** Source B (exact match of known performers against title) is valid and safe for any source.

### Performer extraction — two strict sources only
- Source A: HTML anchor links (`/actor/`, `/pornstar/`, `/model/`, `/actress/`, `/star/`)
- Source B: Exact DB performer pool match inside raw title (multi-word names preferred)
- No title-splitting, no bracket-parsing, no heuristic guessing.
**How to apply:** extractFXPornHDMeta and extractGalaxyPornMeta use HTML links only. scrapeFXPornHD Pass 1 and autoPerformerRepair use DB pool matching.
