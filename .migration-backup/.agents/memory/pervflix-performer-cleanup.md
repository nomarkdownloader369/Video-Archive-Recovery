---
name: PervFlix performer data-quality rules
description: Lessons from fixing two scraper bugs: FXPornHD category-as-performer and GalaxyPorn missing performers.
---

# PervFlix Performer Data-Quality Rules

## Bug 1 — FXPornHD category terms appearing as performer names

**Root cause:** fxpornhd.com marks category slugs (e.g. `/actor/big-tits`) as anchor links. The scraper's HTML performer extraction in `extractFXPornHDMeta` (scraper.ts) picks them up as names.

**Fix:** `FX_PERFORMER_BLOCKLIST` constant added just before the `$("a[href*='/actor/']…")` selector — rejects names like "Big Tits", "Amateur", "MILF", etc. by `name.toLowerCase()` lookup.

**Also:** `purgeFakePerformers` FAKE_WORDS set (index.ts) now includes anatomy/category words ("tits", "ass", "boobs", "anal", "milf", etc.) to clean up any that slip through on existing data.

**Why:** The category pages share the same href pattern as performer profile pages on FXPornHD; no programmatic distinction exists in the HTML.

## Bug 2 — GalaxyPorn (gp-) videos missing performers

### 2a — `purgeUnlistedPerformers` wiping legitimate single-occurrence performers

`purgeUnlistedPerformers` (index.ts) kept only performers in ≥2 videos — legit GP performers with only 1 indexed video got wiped.

**Fix:** After building the frequency-based `validPerformers` set, a second SQL query adds all performers from `slug LIKE 'gp-%'` rows unconditionally (gp- titles are reliable sources).

### 2b — Missing title patterns in `extractPerformersFromGpTitle`

Three patterns were missing:
- **Pattern 2b:** `Studio – Name, Name2 – Scene` (bare studio + double em-dash, no brackets, no date). e.g. "ModelMedia – Zhou Ning, Zhong Wanbing – MD-0361…"
- **Pattern 1b:** `[Studio] Name SceneTitle` (bracket prefix, no em-dash). e.g. "[TonightsGirlfriend] Brooke Wylde Submissive…"
  - Guarded by `SCENE_TITLE_STARTERS` set to skip titles that open with scene words ("family", "the", "this", etc.)
- **`NAME_DESCRIPTOR_SUFFIXES`:** 3-word captures where the last word is a descriptor (e.g. "Cindy Luna Petite") are trimmed to 2 words.

### 2c — FAKE_WORDS false positives

`"love"` and `"loves"` were in FAKE_WORDS — they are real performer surnames ("Journey Love", "Anai Loves"). Removed.

### 2d — `dedupePerformerNames` min-length too strict

Was `>= 4` chars; raised to `>= 3` to keep real short names like "Jai" (3 chars).

**Why:** Must not lower below 3 — "Vi", "Bo" (2 chars) are still filtered correctly.

## Remaining known gaps (intentional)

5 gp- videos still have no performers extractable from title:
- 2 Mature.nl descriptive-sentence titles (performer buried 8+ words in)
- "Dredd Gapes Them All" — single-word performer name, no reliable pattern
- "[FamilyStrokes] Family Competition…" — correctly empty (scene-title words)
- "[LegalPorno] Anabel Busty" — "busty" in FAKE_WORDS blocks it; removing risks "Busty MILF" garbage from HQporner

## FAKE_WORDS safe-to-remove audit

Do NOT add to FAKE_WORDS: "love", "loves", "latina", "ebony" — all real performer surnames.
Safe in FAKE_WORDS: "busty", "petite", "thick", "slim" (rarely real surnames).
