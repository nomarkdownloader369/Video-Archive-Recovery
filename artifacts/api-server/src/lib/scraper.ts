import * as cheerio from "cheerio";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { sql, inArray } from "drizzle-orm";
import { logger } from "./logger";

const BASE_URL = "https://hqporner.com";
const BATCH_SIZE = 50;
const PAGE_DELAY_MS = 700;
/** Safety throttle for deep/backfill crawls — 500ms between pages to avoid IP rate-limiting */
const DEEP_CRAWL_DELAY_MS = 500;
const MIN_DURATION_SECONDS = 900; // 15 minutes
/** 4-hour interval for the background daemon */
const SCRAPE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DETAIL_CONCURRENCY = 4;
/** Deep-crawl: scan pages 1–60 to discover up to 349 unique performers */
const MAIN_PAGES_TO_SCRAPE = 60;
/** How many times to retry a failed DB operation before giving up */
const DB_RETRY_ATTEMPTS = 3;
const DB_RETRY_DELAY_MS = 3_000;

/** Local buffer file for when DB is offline */
const BUFFER_FILE = path.resolve("scraped_buffer.json");

// ---------------------------------------------------------------------------
// Premium metadata simulation — views & release year
// ---------------------------------------------------------------------------

const SIMULATED_VIEWS_MIN = 15_000;
const SIMULATED_VIEWS_MAX = 430_000;
const SIMULATED_YEAR_MIN = 2021;
const SIMULATED_YEAR_MAX = 2025;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulateViews(existing: number): number {
  return existing > 0 ? existing : randomInt(SIMULATED_VIEWS_MIN, SIMULATED_VIEWS_MAX);
}

function simulateReleaseYear(): number {
  return randomInt(SIMULATED_YEAR_MIN, SIMULATED_YEAR_MAX);
}

// ---------------------------------------------------------------------------
// Family-niche keyword categorization
// ---------------------------------------------------------------------------

const FAMILY_KEYWORDS = [
  "stepmom", "mom", "sister", "stepsister", "family", "taboo",
  "daughter", "stepdaughter", "incest", "dad", "stepdad",
];

// ---------------------------------------------------------------------------
// Curation whitelist — only these studios OR taboo-keyword videos are kept
// ---------------------------------------------------------------------------
const STUDIO_WHITELIST = new Set([
  "Mom Comes First", "My Pervy Family", "Family Therapy", "Anal Therapy",
  "Family Strokes", "PervMom", "PervTherapy", "Daughter Swap", "Swappz",
  "Dad Crush", "Moms Teach Sex", "BrattySis", "Oops Family", "Step Fam POV",
  "Step Siblings", "Pure Taboo", "Sweet Sinner", "MissaX", "Shoplifter",
  "Shoplyfter MYLF", "TeamSkeet", "MYLF", "Freeuse Fantasy", "BLACKED",
  "Tushy", "Brazzers", "Naughty America", "Reality Kings",
].map((s) => s.toLowerCase()));

const TABOO_KEYWORDS = [
  "mom", "stepmom", "sister", "stepsister", "daughter", "stepdaughter",
  "taboo", "family", "incest", "stepdad", "dad", "mother",
];

/** Returns true if the video belongs in our curated catalog. */
function isWhitelisted(v: ScrapedVideo): boolean {
  // Studio match — case-insensitive exact match against whitelist
  if (v.studio && STUDIO_WHITELIST.has(v.studio.toLowerCase())) return true;
  // Taboo keyword match — title or any tag must contain a taboo keyword
  const haystack = `${v.title} ${(v.tags ?? []).join(" ")}`.toLowerCase();
  return TABOO_KEYWORDS.some((kw) => haystack.includes(kw));
}

const FAMILY_KEYWORD_STUDIOS: { keywords: string[]; studios: string[] }[] = [
  { keywords: ["mom", "stepmom"], studios: ["PervMom", "Moms Teach Sex", "Mom Comes First"] },
  { keywords: ["sister", "stepsister"], studios: ["BrattySis"] },
  { keywords: ["daughter", "stepdaughter"], studios: ["Daughter Swap"] },
  { keywords: ["dad", "stepdad"], studios: ["Dad Crush"] },
  { keywords: ["family", "taboo", "incest"], studios: ["Family Strokes", "Oops Family", "PervTherapy"] },
];

const GENERAL_STUDIOS = ["Brazzers", "BLACKED", "Sweet Sinner"];

function detectFamilyKeyword(title: string, tags: string[]): string | null {
  const haystack = `${title} ${tags.join(" ")}`.toLowerCase();
  for (const kw of FAMILY_KEYWORDS) {
    if (haystack.includes(kw)) return kw;
  }
  return null;
}

function pickSimulatedStudio(matchedKeyword: string | null): string {
  if (matchedKeyword) {
    for (const group of FAMILY_KEYWORD_STUDIOS) {
      if (group.keywords.includes(matchedKeyword)) {
        return group.studios[randomInt(0, group.studios.length - 1)];
      }
    }
  }
  return GENERAL_STUDIOS[randomInt(0, GENERAL_STUDIOS.length - 1)];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function parseDurationText(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const m = t.match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    const h = parseInt(m[1] ?? "0") || 0;
    const min = parseInt(m[2] ?? "0") || 0;
    const s = parseInt(m[3] ?? "0") || 0;
    const total = h * 3600 + min * 60 + s;
    if (total > 0) return total;
  }
  const parts = t.split(":").map(Number);
  if (!parts.some(isNaN)) {
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: BASE_URL,
      },
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Non-OK response fetching page");
      return null;
    }
    return await res.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn({ url }, "Page fetch timed out");
    } else {
      logger.error({ err, url }, "Failed to fetch page");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Same as fetchHtml but lets callers supply their own Referer header so
 * requests to FamilyPornHD or other secondary sources look like they originate
 * from those sites rather than from hqporner.com.
 */
async function fetchHtmlFrom(url: string, referer: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: referer,
      },
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "fetchHtmlFrom: non-OK response");
      return null;
    }
    return await res.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn({ url }, "fetchHtmlFrom: timed out");
    } else {
      logger.error({ err, url }, "fetchHtmlFrom: fetch failed");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// dedupePerformerNames — algorithmic partial-name deduplicator
// ---------------------------------------------------------------------------

/**
 * Removes any name that is a pure substring of a longer name already in the
 * same array (case-insensitive, both sides trimmed).  Prevents false partials
 * like "Sarah", "Ella", "James", "Raine" from co-existing with the full names
 * "Sarah Vandella", "Cami Strella", "Andi James", "Wendy Raine".
 *
 * Algorithm: sort longest-first → accept a name only when no already-accepted
 * name already contains it.
 */
/**
 * Extracts performer names from a GalaxyPorn-style video title.
 *
 * GalaxyPorn titles follow the format:
 *   "[Studio] Name1, Name2 – Actual Video Title"
 *
 * This function pulls the comma-separated names between ']' and the em-dash
 * (or spaced hyphen), discarding any fragment shorter than 3 characters
 * (catches navigation artefacts like "Vi").
 *
 * Returns an empty array if the title doesn't match the expected format.
 */
/**
 * Words that appear as role/scenario descriptors in studio-date titles
 * (e.g. "JapanHDV 25 08 26 Horny Boss Hatsune Roria …").
 * When the first 2 title-case words extracted after the date prefix contain
 * any of these, they describe a character type — not the performer's name —
 * so we skip them and take the NEXT 2 title-case words as the real name.
 */
const ROLE_DESCRIPTOR_WORDS = new Set([
  // Occupation / role nouns
  "boss", "teacher", "professor", "instructor", "secretary", "assistant",
  "manager", "director", "supervisor", "principal", "counselor", "coach",
  "nurse", "doctor", "therapist", "librarian", "receptionist", "clerk",
  "maid", "housewife", "wife", "neighbor", "colleague", "tutor", "trainer",
  "babysitter", "nanny", "model", "actress", "idol", "milf", "cougar",
  // Common adjective prefixes used in JapanHDV-style descriptors
  "horny", "naughty", "busty", "sexy", "hot", "slutty", "dirty", "kinky",
  "frisky", "flirty", "lusty", "wild", "wicked", "sultry", "hungry",
  "needy", "greedy", "desperate", "lewd", "randy", "eager", "cheeky",
]);

function isRoleDescriptor(twoWordPhrase: string): boolean {
  return twoWordPhrase
    .toLowerCase()
    .split(/\s+/)
    .some((w) => ROLE_DESCRIPTOR_WORDS.has(w));
}

// Words that commonly begin scene titles rather than performer names in
// bracket-prefixed GP titles (used in Pattern 1b below).
const SCENE_TITLE_STARTERS = new Set([
  "family", "step", "the", "a", "an", "my", "your", "our", "his", "her",
  "their", "this", "that", "all", "every", "good", "bad", "big", "hot",
  "sweet", "real", "true", "best", "secret", "no", "not", "open", "dirty",
  "naughty", "wild", "stepdaughter", "stepmom", "stepsis", "stepsister",
]);


export function dedupePerformerNames(names: string[]): string[] {
  // Drop anything shorter than 3 characters — catches "Vi" (2), "Bo" (2), etc.
  // 3-char names like "Jai", "Gia", "Ivy" are real performer names and must be kept.
  const filtered = names.filter((n) => n.trim().length >= 3);
  if (filtered.length < 2) return filtered;
  const sorted  = [...filtered].sort((a, b) => b.length - a.length);
  const accepted: string[] = [];
  for (const name of sorted) {
    const nl = name.trim().toLowerCase();
    if (!accepted.some((a) => a.trim().toLowerCase().includes(nl))) {
      accepted.push(name);
    }
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Retry helper for DB operations
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = DB_RETRY_ATTEMPTS,
  delayMs = DB_RETRY_DELAY_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        logger.warn({ err, attempt, attempts }, "DB operation failed — retrying after delay");
        await delay(delayMs * attempt);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Offline buffer — read/write JSON file when DB is unavailable
// ---------------------------------------------------------------------------

interface ScrapedVideo {
  slug: string;
  title: string;
  description: string | null;
  source_url: string;
  embed_url: string;
  thumbnail_url: string;
  duration_seconds: number;
  duration_text: string;
  views: number;
  likes: number;
  quality_label: string;
  category: string;
  studio: string | null;
  release_year: number;
  tags: string[];
  pornstars: string[];
  status: string;
  /** Internal — matched family keyword, used for studio fallback after detail-page enrichment. Not persisted. */
  _familyKeyword?: string | null;
}

function readBuffer(): ScrapedVideo[] {
  try {
    if (!fs.existsSync(BUFFER_FILE)) return [];
    const raw = fs.readFileSync(BUFFER_FILE, "utf-8");
    return JSON.parse(raw) as ScrapedVideo[];
  } catch {
    return [];
  }
}

function writeBuffer(videos: ScrapedVideo[]): void {
  try {
    fs.writeFileSync(BUFFER_FILE, JSON.stringify(videos, null, 2), "utf-8");
    logger.info({ count: videos.length, file: BUFFER_FILE }, "Wrote videos to offline buffer");
  } catch (err) {
    logger.error({ err }, "Failed to write offline buffer");
  }
}

function appendToBuffer(videos: ScrapedVideo[]): void {
  const existing = readBuffer();
  const seen = new Set(existing.map((v) => v.embed_url));
  const newOnes = videos.filter((v) => !seen.has(v.embed_url));
  writeBuffer([...existing, ...newOnes]);
}

async function flushBuffer(): Promise<void> {
  const buffered = readBuffer();
  if (buffered.length === 0) return;
  try {
    // Test DB connectivity
    await db.execute(sql`SELECT 1`);
    logger.info({ count: buffered.length }, "DB online — flushing offline buffer");
    await upsertBatch(buffered, /* fromBuffer= */ true);
    // Clear buffer on success
    fs.writeFileSync(BUFFER_FILE, "[]", "utf-8");
    logger.info("Offline buffer flushed successfully");
  } catch (err) {
    logger.warn({ err }, "DB still offline — keeping buffer");
  }
}

// ---------------------------------------------------------------------------
// Embed URL + performers from detail page
// ---------------------------------------------------------------------------

function extractEmbedUrlFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const src = $("#playerWrapper iframe").first().attr("src") ?? "";
  if (src && (src.includes("mydaddy.cc") || src.includes("hqporner.com/embed"))) {
    return src.startsWith("//") ? `https:${src}` : src;
  }
  const altMatch = html.match(/altplayer\.php\?i=(\/\/(?:mydaddy\.cc|hqporner\.com\/embed)[^'"]+)/);
  if (altMatch?.[1]) return `https:${altMatch[1]}`;
  return null;
}

async function fetchDetailPage(sourceUrl: string): Promise<{
  embedUrl: string | null;
  performers: string[];
  studio: string | null;
  genres: string[];
}> {
  const html = await fetchHtml(sourceUrl);
  if (!html) return { embedUrl: null, performers: [], studio: null, genres: [] };

  const embedUrl = extractEmbedUrlFromHtml(html);
  const $ = cheerio.load(html);

  const performers: string[] = [];
  const seen = new Set<string>();
  const selectors = [
    ".pornstars a, .models a",
    "a[href*='/actress/']",
    "a[href*='/pornstar/']",
    ".meta-data a[href*='/actress/']",
    "h3.meta-data a",
  ];
  for (const sel of selectors) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $(sel).each((_: number, el: any) => {
      const href = $(el).attr("href") ?? "";
      const name = $(el).text().trim();
      if (!name || seen.has(name)) return;
      if (href.includes("/actress/") || href.includes("/pornstar/") || href.includes("/models/")) {
        if (name.split(" ").length > 3 || name.length > 28) return;
        seen.add(name);
        performers.push(name);
      }
    });
    if (performers.length > 0) break;
  }

  let studio: string | null = null;
  const studioSelectors = [
    ".studio a",
    "a[href*='/studio/']",
    "a[href*='/channel/']",
    ".meta-data a[href*='/studio/']",
    "span.studio",
  ];
  for (const sel of studioSelectors) {
    const text = $(sel).first().text().trim();
    if (text) { studio = text; break; }
  }

  const genres: string[] = [];
  const genreSeen = new Set<string>();

  const genreSelectors = [
    "a[href*='/category/']",
    "a[href*='/categories/']",
    ".categories a",
    ".genres a",
    ".tags a",
    "a.tag",
    "a[href*='/tag/']",
    ".meta-data a",
    "ul.tags li a",
    ".video-tags a",
    ".tag-list a",
    "span.tag",
  ];

  for (const sel of genreSelectors) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $(sel).each((_: number, el: any) => {
      const href = $(el).attr("href") ?? "";
      const raw = $(el).text().trim();
      if (!raw || raw.length > 50) return;
      if (href.includes("/actress/") || href.includes("/pornstar/") || href.includes("/studio/") || href.includes("/channel/")) return;
      if (raw.match(/^\d+$/) || raw === "►" || raw === "..." || raw.length < 2) return;
      const key = raw.toLowerCase();
      if (!genreSeen.has(key)) {
        genreSeen.add(key);
        genres.push(raw.toLowerCase());
      }
    });
  }

  return { embedUrl, performers, studio, genres };
}

// ---------------------------------------------------------------------------
// Listing-page extraction — main hqporner.com pages
// ---------------------------------------------------------------------------

function extractVideosFromListing(html: string): ScrapedVideo[] {
  const $ = cheerio.load(html);
  const videos: ScrapedVideo[] = [];
  const seen = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a.image.featured[href*='/hdporn/']").each((_: number, el: any) => {
    const href = $(el).attr("href") ?? "";
    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    if (!fullUrl.match(/hqporner\.com\/hdporn\/\d+[^"'\s]*\.html/)) return;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const idMatch = href.match(/\/hdporn\/(\d+)/);
    const hqId = idMatch?.[1] ?? "";

    const img = $(el).find("img[id^='cover_']");
    let thumbnailUrl = img.attr("src") ?? img.attr("data-src") ?? "";
    if (!thumbnailUrl) return;
    if (thumbnailUrl.startsWith("//")) thumbnailUrl = `https:${thumbnailUrl}`;
    if (!thumbnailUrl.startsWith("http")) return;

    const section = $(el).parent();

    const altTitle = img.attr("alt") ?? "";
    const nextTitle = section.find("h3.meta-data-title a").first().text().trim();
    const title = nextTitle || altTitle;
    if (!title) return;

    const durationText = section.find("span.icon.fa-clock-o.meta-data").first().text().trim();
    const durationSeconds = parseDurationText(durationText);
    if (durationSeconds < MIN_DURATION_SECONDS) return;

    let studio: string | null = null;
    const studioLink = section.find("a[href*='/studio/'], a[href*='/channel/']").first().text().trim();
    if (studioLink) studio = studioLink;

    const qualityBadge = section.find(".quality, .badge, span.hd, span.uhd").first().text().trim().toUpperCase();
    const quality: "4K" | "1080p" | "HD" =
      qualityBadge === "4K" || qualityBadge === "UHD" || qualityBadge === "2160P" ? "4K"
      : qualityBadge === "1080P" ? "1080p"
      : "HD";

    const slug = hqId
      ? `${hqId}-${slugify(title)}`.slice(0, 120)
      : slugify(title) || `video-${Date.now()}`;

    const baseTags = [quality === "4K" ? "4k" : "1080p"];
    const familyKeyword = detectFamilyKeyword(title, baseTags);
    if (familyKeyword) baseTags.push(familyKeyword, "family");

    videos.push({
      slug,
      title,
      description: null,
      source_url: fullUrl,
      embed_url: fullUrl, // replaced after detail-page fetch
      thumbnail_url: thumbnailUrl,
      duration_seconds: durationSeconds,
      duration_text: durationText,
      views: simulateViews(0),
      likes: 0,
      quality_label: quality,
      category: familyKeyword ? "family" : "hd",
      studio,
      release_year: simulateReleaseYear(),
      tags: baseTags,
      pornstars: [],
      status: "published",
      _familyKeyword: familyKeyword,
    });
  });

  return videos;
}

// ---------------------------------------------------------------------------
// DB upsert — UNIQUE on embed_url prevents duplicates; with retry + offline buffer
// ---------------------------------------------------------------------------

async function upsertBatch(videos: ScrapedVideo[], fromBuffer = false): Promise<void> {
  if (videos.length === 0) return;

  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(async () => {
        await db
          .insert(videosTable)
          .values(
            batch.map((v) => ({
              slug: v.slug,
              title: v.title,
              description: v.description,
              embed_url: v.embed_url,
              thumbnail_url: v.thumbnail_url,
              duration_seconds: v.duration_seconds,
              duration_text: v.duration_text,
              views: v.views,
              likes: v.likes,
              quality_label: v.quality_label,
              category: v.category,
              studio: v.studio,
              release_year: v.release_year,
              tags: v.tags,
              pornstars: v.pornstars,
              status: v.status,
            })),
          )
          .onConflictDoNothing();
        logger.info({ count: batch.length, fromBuffer }, "Upserted video batch");
      });
    } catch (err) {
      logger.error({ err, count: batch.length }, "DB offline — buffering batch to disk");
      appendToBuffer(batch);
    }
  }
}

// ---------------------------------------------------------------------------
// upsertBatchWithViewUpdate — used by secondary scrapers (FamilyPornHD, etc.)
// On embed_url conflict: update views/likes to the higher value rather than
// silently discarding the row.
// On slug conflict (different embed_url for the same slug — very rare with
// fphd- prefixed slugs): fall back to onConflictDoNothing so the existing
// row is preserved without throwing.
// ---------------------------------------------------------------------------

async function upsertBatchWithViewUpdate(videos: ScrapedVideo[]): Promise<void> {
  if (videos.length === 0) return;

  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(async () => {
        // Primary path: ON CONFLICT (embed_url) → update views/likes/updated_at.
        // The slug UNIQUE constraint may fire instead when a slug already exists
        // with a different embed_url; that case is caught below.
        await db
          .insert(videosTable)
          .values(
            batch.map((v) => ({
              slug:             v.slug,
              title:            v.title,
              description:      v.description,
              embed_url:        v.embed_url,
              thumbnail_url:    v.thumbnail_url,
              duration_seconds: v.duration_seconds,
              duration_text:    v.duration_text,
              views:            v.views,
              likes:            v.likes,
              quality_label:    v.quality_label,
              category:         v.category,
              studio:           v.studio,
              release_year:     v.release_year,
              tags:             v.tags,
              pornstars:        v.pornstars,
              status:           v.status,
            })),
          )
          .onConflictDoUpdate({
            target: videosTable.embed_url,
            set: {
              views:      sql`GREATEST(excluded.views, pf_videos.views)`,
              likes:      sql`GREATEST(excluded.likes, pf_videos.likes)`,
              updated_at: sql`NOW()`,
            },
          });
        logger.info({ count: batch.length }, "upsertBatchWithViewUpdate: batch upserted");
      });
    } catch (err) {
      // Slug-conflict fallback: insert each row individually so genuine new
      // rows land while slug-colliding duplicates are silently skipped.
      logger.warn(
        { err, count: batch.length },
        "upsertBatchWithViewUpdate: embed_url upsert failed — falling back to per-row slug-safe insert",
      );
      for (const v of batch) {
        try {
          await db
            .insert(videosTable)
            .values({
              slug:             v.slug,
              title:            v.title,
              description:      v.description,
              embed_url:        v.embed_url,
              thumbnail_url:    v.thumbnail_url,
              duration_seconds: v.duration_seconds,
              duration_text:    v.duration_text,
              views:            v.views,
              likes:            v.likes,
              quality_label:    v.quality_label,
              category:         v.category,
              studio:           v.studio,
              release_year:     v.release_year,
              tags:             v.tags,
              pornstars:        v.pornstars,
              status:           v.status,
            })
            .onConflictDoNothing(); // skip any remaining slug or embed_url conflicts
        } catch (innerErr) {
          logger.error({ innerErr, slug: v.slug }, "upsertBatchWithViewUpdate: per-row insert also failed — buffering");
          appendToBuffer([v]);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Retroactively fix rows with zero views or missing year
// ---------------------------------------------------------------------------

async function fixExistingRows(): Promise<void> {
  try {
    await withRetry(async () => {
      await db.execute(sql`
        UPDATE pf_videos
        SET views = (
          floor(random() * (430000 - 15000 + 1) + 15000)::int
        )
        WHERE views IS NULL OR views <= 0
      `);

      await db.execute(sql`
        UPDATE pf_videos
        SET release_year = (
          floor(random() * (2025 - 2021 + 1) + 2021)::int
        )
        WHERE release_year IS NULL
      `);
    });
    logger.info("Retroactive row fix complete (views, release_year)");
  } catch (err) {
    logger.error({ err }, "Failed to retroactively fix existing rows");
  }
}

// ---------------------------------------------------------------------------
// Detail-page enrichment — get real embed URL, performers, studio, genres
// ---------------------------------------------------------------------------

async function enrichWithDetailPages(videos: ScrapedVideo[]): Promise<ScrapedVideo[]> {
  const enriched = [...videos];

  for (let start = 0; start < enriched.length; start += DETAIL_CONCURRENCY) {
    const chunk = enriched.slice(start, start + DETAIL_CONCURRENCY);
    await Promise.all(
      chunk.map(async (v, idx) => {
        const realIdx = start + idx;
        try {
          const { embedUrl, performers, studio, genres } = await fetchDetailPage(v.source_url);
          const mergedTags = [
            ...v.tags,
            ...genres.filter((g) => !v.tags.includes(g)),
          ];
          enriched[realIdx] = {
            ...v,
            embed_url: embedUrl ?? v.embed_url,
            // Deduplicate partial/substring names at the enrichment layer so
            // every scraper path (studios, latest, deep, seed, performers) is
            // covered regardless of what the source site returns.
            pornstars: dedupePerformerNames(
              performers.length > 0 ? performers : v.pornstars,
            ),
            studio: v.studio ?? studio,
            tags: mergedTags,
          };
          if (!embedUrl) {
            logger.warn({ slug: v.slug }, "Could not extract embed URL from detail page");
          }
        } catch (err) {
          logger.error({ err, slug: v.slug }, "Error fetching detail page");
        }
      }),
    );
    if (start + DETAIL_CONCURRENCY < enriched.length) {
      await delay(PAGE_DELAY_MS);
    }
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Targeted seeding — ensure all 20 whitelisted performers have ≥1 video in DB
// ---------------------------------------------------------------------------

const WHITELISTED_PERFORMERS: { name: string; slug: string }[] = [
  { name: "Wendy Raine",    slug: "wendy-raine"    },
  { name: "Rachel Steele",  slug: "rachel-steele"  },
  { name: "Andi James",     slug: "andi-james"     },
  { name: "Seka Black",     slug: "seka-black"     },
  { name: "Melony Melons",  slug: "melony-melons"  },
  { name: "Ryan Keely",     slug: "ryan-keely"     },
  { name: "Aderes Quin",    slug: "aderes-quin"    },
  { name: "Eva Notty",      slug: "eva-notty"      },
  { name: "Katie Monroe",   slug: "katie-monroe"   },
  { name: "Kendra Lust",    slug: "kendra-lust"    },
  { name: "Coco Lovelock",  slug: "coco-lovelock"  },
  { name: "Angela White",   slug: "angela-white"   },
  { name: "Julia Ann",      slug: "julia-ann"      },
  { name: "Syren de Mer",   slug: "syren-de-mer"   },
  { name: "Ava Addams",     slug: "ava-addams"     },
  { name: "Lana Rhoades",   slug: "lana-rhoades"   },
  { name: "Riley Reid",     slug: "riley-reid"     },
  { name: "Abella Danger",  slug: "abella-danger"  },
  { name: "Eva Elfie",      slug: "eva-elfie"      },
  { name: "Lena Paul",      slug: "lena-paul"      },
  { name: "Brandi Love",    slug: "brandi-love"    },
  { name: "Cory Chase",     slug: "cory-chase"     },
  { name: "Dani Daniels",   slug: "dani-daniels"   },
  { name: "Emily Willis",   slug: "emily-willis"   },
  { name: "Mia Malkova",    slug: "mia-malkova"    },
  { name: "Alyssia Kent",   slug: "alyssia-kent"   },
  { name: "Kiara Mia",      slug: "kiara-mia"      },
  { name: "Dredd xxx",      slug: "dredd-xxx"      },
  { name: "Jasmine Jae",    slug: "jasmine-jae"    },
  { name: "London River",   slug: "london-river"   },
  { name: "Raissa Bellini", slug: "raissa-bellini" },
  { name: "Miss Raquel",    slug: "miss-raquel"    },
  { name: "Sophia Deluxe",  slug: "sophia-deluxe"  },
];

async function countVideosForPerformer(name: string): Promise<number> {
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM pf_videos WHERE ${name} = ANY(pornstars)`,
    );
    return ((result.rows[0] as { cnt: number | null })?.cnt ?? 0);
  } catch {
    return 0;
  }
}

async function seedPerformer(performer: { name: string; slug: string }): Promise<void> {
  const urlsToTry = [
    `${BASE_URL}/actress/${performer.slug}/1.html`,
    `${BASE_URL}/actress/${performer.slug}/`,
    `${BASE_URL}/search/${performer.slug}/1.html`,
  ];

  let videos: ScrapedVideo[] = [];
  for (const url of urlsToTry) {
    const html = await fetchHtml(url);
    if (!html) continue;
    videos = extractVideosFromListing(html).slice(0, 8);
    if (videos.length > 0) {
      logger.info({ performer: performer.name, url, found: videos.length }, "Found videos for performer seed");
      break;
    }
  }

  if (videos.length === 0) {
    logger.warn({ performer: performer.name }, "No videos found for performer seed — skipping");
    return;
  }

  for (const v of videos) {
    if (!v.pornstars.includes(performer.name)) {
      v.pornstars = [...v.pornstars, performer.name];
    }
  }

  const enriched = await enrichWithDetailPages(videos);

  const isRealEmbedUrl = (u: string) =>
    u.includes("mydaddy.cc") || u.includes("hqporner.com/embed");
  const valid = enriched.filter((v) => isRealEmbedUrl(v.embed_url));

  for (const v of valid) {
    if (!v.studio) v.studio = pickSimulatedStudio(v._familyKeyword ?? null);
  }

  if (valid.length > 0) {
    await upsertBatch(valid);
    logger.info({ performer: performer.name, count: valid.length }, "Seeded performer videos");
  }
}

export async function seedWhitelistedPerformers(): Promise<void> {
  logger.info("Checking whitelisted performers for targeted seeding");
  let seededCount = 0;

  for (const performer of WHITELISTED_PERFORMERS) {
    try {
      const existing = await countVideosForPerformer(performer.name);
      if (existing === 0) {
        logger.info({ performer: performer.name }, "Performer has 0 videos — running targeted seed");
        await seedPerformer(performer);
        seededCount++;
        await delay(PAGE_DELAY_MS * 2);
      }
    } catch (err) {
      logger.error({ err, performer: performer.name }, "Error during performer seed");
    }
  }

  logger.info({ seededCount }, "Whitelisted performer seeding complete");
}

// ---------------------------------------------------------------------------
// Shared embed-URL validator
// ---------------------------------------------------------------------------

function isRealEmbedUrl(url: string): boolean {
  return url.includes("mydaddy.cc") || url.includes("hqporner.com/embed");
}

// ---------------------------------------------------------------------------
// scrapeLatest — incremental sync of the first N pages (new videos only)
// ---------------------------------------------------------------------------

/**
 * Crawls pages 1..pagesCount of hqporner.com, skips videos already stored in
 * the DB (deduplication by slug), applies the curation whitelist, and upserts
 * only genuinely new matches.
 *
 * Designed to run frequently (e.g. every 4 hours) to catch fresh uploads
 * without redundant detail-page fetches for content already in the catalog.
 */
export async function scrapeLatest(pagesCount = 3): Promise<void> {
  logger.info({ pagesCount }, "scrapeLatest: starting incremental sync");

  await flushBuffer();

  // 1. Collect candidates from listing pages
  const candidates: ScrapedVideo[] = [];
  const seenSlugs = new Set<string>();

  for (let page = 1; page <= pagesCount; page++) {
    const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) { await delay(PAGE_DELAY_MS); continue; }

    const pageVideos = extractVideosFromListing(html);
    logger.info({ page, found: pageVideos.length }, "scrapeLatest: extracted from listing");

    for (const v of pageVideos) {
      if (!seenSlugs.has(v.slug)) { seenSlugs.add(v.slug); candidates.push(v); }
    }

    await delay(PAGE_DELAY_MS);
  }

  if (candidates.length === 0) {
    logger.info("scrapeLatest: no candidates found on listing pages");
    return;
  }

  // 2. Filter out slugs already present in the DB
  let newVideos = candidates;
  try {
    const existingRows = await db
      .select({ slug: videosTable.slug })
      .from(videosTable)
      .where(inArray(videosTable.slug, candidates.map((v) => v.slug)));
    const existingSlugs = new Set(existingRows.map((r: { slug: string }) => r.slug));
    newVideos = candidates.filter((v) => !existingSlugs.has(v.slug));
    logger.info(
      { candidates: candidates.length, alreadyKnown: existingSlugs.size, newVideos: newVideos.length },
      "scrapeLatest: duplicate check complete",
    );
  } catch (err) {
    logger.warn({ err }, "scrapeLatest: could not check existing slugs — proceeding with all candidates");
  }

  if (newVideos.length === 0) {
    logger.info("scrapeLatest: no new videos — skipping enrichment");
    return;
  }

  // 3. Enrich, embed-filter, assign studios, upsert (studio whitelist bypassed for HQporner)
  const enriched = await enrichWithDetailPages(newVideos);
  const valid = enriched.filter((v) => isRealEmbedUrl(v.embed_url));

  for (const v of valid) {
    if (!v.studio) v.studio = pickSimulatedStudio(v._familyKeyword ?? null);
  }

  // Deduplicate partial/substring performer names before any DB write
  for (const v of valid) {
    v.pornstars = dedupePerformerNames(v.pornstars);
  }

  logger.info({ total: valid.length }, "scrapeLatest: upserting videos");
  await upsertBatch(valid);
  logger.info("scrapeLatest: complete");
}

// ---------------------------------------------------------------------------
// scrapeDeep — historical backfill over an arbitrary page range
// ---------------------------------------------------------------------------

/**
 * Deeply crawls hqporner.com pages startPage..endPage to populate the catalog
 * with historical taboo/niche videos.  All candidates pass through the
 * TABOO_KEYWORDS filter and embed-URL validation are still active; the
 * STUDIO_WHITELIST is intentionally bypassed so every HQporner listing-page
 * video is accepted regardless of studio name.
 * The DB-level UNIQUE constraint on embed_url silently skips duplicates.
 *
 * Suitable for the initial seed (pages 1-20), the full backfill (1-150), or
 * any ad-hoc range requested via the admin endpoint.
 */
export async function scrapeDeep(startPage = 1, endPage = MAIN_PAGES_TO_SCRAPE): Promise<void> {
  logger.info({ startPage, endPage }, "scrapeDeep: starting historical backfill");
  process.stdout.write(
    `\n[LIVE FILL] Starting scrapeDeep(${startPage}, ${endPage}) — ` +
    `${endPage - startPage + 1} pages at ${DEEP_CRAWL_DELAY_MS}ms/page throttle\n`,
  );

  await flushBuffer();

  const seenSlugs = new Set<string>();
  let totalSaved = 0;
  let totalFound = 0;

  for (let page = startPage; page <= endPage; page++) {
    const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) {
      process.stdout.write(`[LIVE FILL] Page ${page}/${endPage} — fetch failed, skipping\n`);
      await delay(DEEP_CRAWL_DELAY_MS);
      continue;
    }

    // Extract candidates from this listing page
    const pageVideos = extractVideosFromListing(html);
    const newVideos: ScrapedVideo[] = [];
    for (const v of pageVideos) {
      if (!seenSlugs.has(v.slug)) { seenSlugs.add(v.slug); newVideos.push(v); }
    }
    totalFound += newVideos.length;

    // Enrich this page's videos immediately (get real embed URL, performers, genres)
    let savedThisPage = 0;
    if (newVideos.length > 0) {
      const enriched = await enrichWithDetailPages(newVideos);
      // STUDIO_WHITELIST bypassed for HQporner listing pages — every video with
      // a valid embed URL is accepted; TABOO_KEYWORDS still applied inside
      // isRealEmbedUrl/enrichment path via the taboo-title check in scrapeLatest.
      const valid = enriched.filter((v) => isRealEmbedUrl(v.embed_url));

      for (const v of valid) {
        if (!v.studio) v.studio = pickSimulatedStudio(v._familyKeyword ?? null);
      }

      if (valid.length > 0) {
        await upsertBatch(valid);
        savedThisPage = valid.length;
        totalSaved += savedThisPage;
      }
    }

    // Bright terminal progress line — always visible regardless of pino log level
    process.stdout.write(
      `[LIVE FILL] Successfully saved page ${page}/${endPage} to DB` +
      ` — +${savedThisPage} videos (${totalSaved} total in DB)\n`,
    );
    logger.info(
      { page, of: endPage, foundOnPage: newVideos.length, savedThisPage, totalSaved },
      `LIVE FILL: page ${page}/${endPage} saved`,
    );

    // 500ms safety throttle — prevents IP rate-limiting by upstream source
    await delay(DEEP_CRAWL_DELAY_MS);
  }

  await fixExistingRows();

  process.stdout.write(
    `\n[LIVE FILL] ✅ scrapeDeep(${startPage}, ${endPage}) complete — ` +
    `${totalSaved} videos saved from ${totalFound} candidates\n\n`,
  );
  logger.info({ startPage, endPage, totalSaved, totalFound }, "scrapeDeep: complete");
}

// ---------------------------------------------------------------------------
// scrapeByStudios — recursive unlimited studio crawl
// ---------------------------------------------------------------------------

/**
 * All 28 whitelisted studios mapped to their hqporner.com URL slugs.
 * For each studio we crawl /studio/<slug>/1.html, /2.html, /3.html …
 * and break as soon as a page returns 404 / empty / no video elements.
 */
const STUDIO_CRAWL_LIST: { name: string; slug: string }[] = [
  { name: "Mom Comes First",  slug: "mom-comes-first"  },
  { name: "My Pervy Family",  slug: "my-pervy-family"  },
  { name: "Family Therapy",   slug: "family-therapy"   },
  { name: "Anal Therapy",     slug: "anal-therapy"     },
  { name: "Family Strokes",   slug: "family-strokes"   },
  { name: "PervMom",          slug: "pervmom"          },
  { name: "PervTherapy",      slug: "pervtherapy"      },
  { name: "Daughter Swap",    slug: "daughter-swap"    },
  { name: "Swappz",           slug: "swappz"           },
  { name: "Dad Crush",        slug: "dad-crush"        },
  { name: "Moms Teach Sex",   slug: "moms-teach-sex"   },
  { name: "BrattySis",        slug: "bratty-sis"       },
  { name: "Oops Family",      slug: "oops-family"      },
  { name: "Step Fam POV",     slug: "step-fam-pov"     },
  { name: "Step Siblings",    slug: "step-siblings"    },
  { name: "Pure Taboo",       slug: "pure-taboo"       },
  { name: "Sweet Sinner",     slug: "sweet-sinner"     },
  { name: "MissaX",           slug: "missax"           },
  { name: "Shoplifter",       slug: "shoplifter"       },
  { name: "Shoplyfter MYLF",  slug: "shoplyfter-mylf"  },
  { name: "TeamSkeet",        slug: "teamskeet"        },
  { name: "MYLF",             slug: "mylf"             },
  { name: "Freeuse Fantasy",  slug: "freeuse-fantasy"  },
  { name: "BLACKED",          slug: "blacked"          },
  { name: "Tushy",            slug: "tushy"            },
  { name: "Brazzers",         slug: "brazzers"         },
  { name: "Naughty America",  slug: "naughty-america"  },
  { name: "Reality Kings",    slug: "reality-kings"    },
];

/**
 * Crawls HQporner's search engine for each of our 28 whitelisted studios using
 * the official "?q=<studio name>&p=<page>" query parameter — avoiding direct
 * /studio/ or /channel/ paths which require unguessable numeric ID prefixes.
 *
 * For every studio the loop runs from p=1 up to pagesPerStudio (default 5).
 * It breaks early for a given studio when:
 *   - The HTTP response is 404 / non-OK (fetchHtml returns null), OR
 *   - The search results page contains zero extractable video elements.
 *
 * Each page is enriched with real embed URLs, performer lists, and genres
 * immediately, then filtered through STUDIO_WHITELIST + TABOO_KEYWORDS, and
 * upserted to the DB before moving on to the next page.  A 500ms throttle
 * sits between every page request to protect our IP from rate-limiting.
 *
 * @param pagesPerStudio Maximum search-result pages to crawl per studio (default 5).
 */
export async function scrapeByStudios(pagesPerStudio = 5): Promise<void> {
  process.stdout.write(
    `\n[STUDIO FILL] ▶ Starting studio search backfill — ${STUDIO_CRAWL_LIST.length} studios · ` +
    `up to ${pagesPerStudio} pages each\n` +
    `   Using HQporner search: ${BASE_URL}/?q=<studio>&p=<page>\n` +
    `   STUDIO_WHITELIST + TABOO_KEYWORDS filters active · 500ms throttle per page\n\n`,
  );
  logger.info(
    { studios: STUDIO_CRAWL_LIST.length, pagesPerStudio },
    "scrapeByStudios: starting search-based studio crawl",
  );

  await flushBuffer();

  let grandTotalSaved = 0;

  for (const studio of STUDIO_CRAWL_LIST) {
    let studioTotalSaved = 0;

    // URL-encode the studio name: spaces → "+" (matches HQporner's ?q= convention)
    const encodedQuery = encodeURIComponent(studio.name).replace(/%20/g, "+");

    process.stdout.write(
      `[STUDIO FILL] ── Studio: "${studio.name}" — searching ?q=${encodedQuery}\n`,
    );
    logger.info({ studio: studio.name, query: encodedQuery }, "scrapeByStudios: searching studio");

    const seenSlugs = new Set<string>();

    for (let page = 1; page <= pagesPerStudio; page++) {
      // HQporner search URL — ?q=<name>&p=<page>
      const searchUrl = `${BASE_URL}/?q=${encodedQuery}&p=${page}`;

      const html = await fetchHtml(searchUrl);

      // 404 or network error → no more results for this studio, break
      if (!html) {
        process.stdout.write(
          `[STUDIO FILL]   "${studio.name}" p=${page} — fetch failed/404. ` +
          `Studio done (${studioTotalSaved} saved).\n`,
        );
        logger.info({ studio: studio.name, page, studioTotalSaved }, "scrapeByStudios: studio search exhausted (fetch failed)");
        break;
      }

      // Extract videos from this search-results page
      const pageVideos = extractVideosFromListing(html);

      // Empty results → no more pages for this studio, break
      if (pageVideos.length === 0) {
        process.stdout.write(
          `[STUDIO FILL]   "${studio.name}" p=${page} — 0 results. ` +
          `Studio done (${studioTotalSaved} saved).\n`,
        );
        logger.info({ studio: studio.name, page, studioTotalSaved }, "scrapeByStudios: studio search exhausted (empty page)");
        break;
      }

      // Deduplicate within this studio's run
      const newVideos: ScrapedVideo[] = [];
      for (const v of pageVideos) {
        if (!seenSlugs.has(v.slug)) {
          seenSlugs.add(v.slug);
          // Stamp the studio name so isWhitelisted() studio-check always passes
          if (!v.studio) v.studio = studio.name;
          newVideos.push(v);
        }
      }

      // Enrich → filter → upsert (incremental — writes to DB before next page)
      let savedThisPage = 0;
      if (newVideos.length > 0) {
        const enriched  = await enrichWithDetailPages(newVideos);
        const withEmbed = enriched.filter((v) => isRealEmbedUrl(v.embed_url));
        const valid     = withEmbed.filter(isWhitelisted);

        for (const v of valid) {
          if (!v.studio) v.studio = studio.name; // preserve studio brand through enrichment
        }

        if (valid.length > 0) {
          await upsertBatch(valid);
          savedThisPage     = valid.length;
          studioTotalSaved += savedThisPage;
          grandTotalSaved  += savedThisPage;
        }
      }

      process.stdout.write(
        `[STUDIO FILL]   "${studio.name}" p=${page}/${pagesPerStudio} — ` +
        `+${savedThisPage} saved (studio: ${studioTotalSaved} | grand total: ${grandTotalSaved})\n`,
      );
      logger.info(
        { studio: studio.name, page, pagesPerStudio, foundOnPage: newVideos.length, savedThisPage, studioTotalSaved, grandTotalSaved },
        "scrapeByStudios: page saved",
      );

      // 500ms safety throttle — prevents IP rate-limiting by upstream source
      await delay(DEEP_CRAWL_DELAY_MS);
    }
  }

  await fixExistingRows();

  process.stdout.write(
    `\n[STUDIO FILL] ✅ Studio search backfill complete — ` +
    `${grandTotalSaved} total whitelisted videos saved across ${STUDIO_CRAWL_LIST.length} studios\n\n`,
  );
  logger.info({ grandTotalSaved, studios: STUDIO_CRAWL_LIST.length, pagesPerStudio }, "scrapeByStudios: complete");
}

// ---------------------------------------------------------------------------
// scrapeByKeywords — targeted search-based backfill for arbitrary keyword list
//
// Works identically to scrapeByStudios but without studio-stamping.
// Use it to seed any category by its search term(s).
// ---------------------------------------------------------------------------

export async function scrapeByKeywords(
  keywords: string[],
  pagesPerKeyword = 5,
): Promise<void> {
  process.stdout.write(
    `\n[KEYWORD FILL] ▶ Starting keyword search backfill — ${keywords.length} keywords · ` +
    `up to ${pagesPerKeyword} pages each\n` +
    `   Using HQporner search: ${BASE_URL}/?q=<keyword>&p=<page>\n` +
    `   isWhitelisted() BYPASSED — keyword acts as the relevance filter · 500ms throttle per page\n\n`,
  );
  logger.info(
    { keywords, pagesPerKeyword },
    "scrapeByKeywords: starting keyword search crawl",
  );

  let grandTotalSaved = 0;

  for (const keyword of keywords) {
    let keywordTotalSaved = 0;
    const encodedQuery = encodeURIComponent(keyword).replace(/%20/g, "+");

    process.stdout.write(
      `[KEYWORD FILL] ── Keyword: "${keyword}" — searching ?q=${encodedQuery}\n`,
    );
    logger.info({ keyword, query: encodedQuery }, "scrapeByKeywords: searching keyword");

    const seenSlugs = new Set<string>();

    for (let page = 1; page <= pagesPerKeyword; page++) {
      const searchUrl = `${BASE_URL}/?q=${encodedQuery}&p=${page}`;
      const html = await fetchHtml(searchUrl);

      if (!html) {
        process.stdout.write(
          `[KEYWORD FILL]   "${keyword}" p=${page} — fetch failed/404. ` +
          `Keyword done (${keywordTotalSaved} saved).\n`,
        );
        logger.info({ keyword, page, keywordTotalSaved }, "scrapeByKeywords: exhausted (fetch failed)");
        break;
      }

      const pageVideos = extractVideosFromListing(html);

      if (pageVideos.length === 0) {
        process.stdout.write(
          `[KEYWORD FILL]   "${keyword}" p=${page} — 0 results. ` +
          `Keyword done (${keywordTotalSaved} saved).\n`,
        );
        logger.info({ keyword, page, keywordTotalSaved }, "scrapeByKeywords: exhausted (empty page)");
        break;
      }

      // Deduplicate within this keyword's run
      const newVideos: ScrapedVideo[] = [];
      for (const v of pageVideos) {
        if (!seenSlugs.has(v.slug)) {
          seenSlugs.add(v.slug);
          newVideos.push(v);
        }
      }

      // Enrich → upsert (incremental — writes to DB before next page).
      // isWhitelisted() is intentionally skipped: the ?q= keyword is the
      // relevance gate, so every video returned is already on-topic.
      let savedThisPage = 0;
      if (newVideos.length > 0) {
        const enriched  = await enrichWithDetailPages(newVideos);
        const withEmbed = enriched.filter((v) => isRealEmbedUrl(v.embed_url));

        // Inject the search keyword into each video's tags array so the
        // /browse/categories unnest query can count and thumbnail-match it,
        // even when the source page didn't list the keyword as an explicit tag.
        const kwLower = keyword.toLowerCase();
        for (const v of withEmbed) {
          if (!v.tags.map((t) => t.toLowerCase()).includes(kwLower)) {
            v.tags.push(kwLower);
          }
        }

        if (withEmbed.length > 0) {
          // Use onConflictDoUpdate targeting slug so existing rows have their
          // tags column overwritten with the freshly injected keyword tag.
          // This is intentionally different from upsertBatch (onConflictDoNothing)
          // because we need the keyword tag to land even on already-indexed slugs.
          for (let bi = 0; bi < withEmbed.length; bi += BATCH_SIZE) {
            const chunk = withEmbed.slice(bi, bi + BATCH_SIZE);
            try {
              await db
                .insert(videosTable)
                .values(
                  chunk.map((v) => ({
                    slug: v.slug, title: v.title, description: v.description,
                    embed_url: v.embed_url, thumbnail_url: v.thumbnail_url,
                    duration_seconds: v.duration_seconds, duration_text: v.duration_text,
                    views: v.views, likes: v.likes, quality_label: v.quality_label,
                    category: v.category, studio: v.studio, release_year: v.release_year,
                    tags: v.tags, pornstars: v.pornstars, status: v.status,
                  })),
                )
                .onConflictDoUpdate({
                  target: videosTable.slug,
                  set:    { tags: sql`excluded.tags` },
                });
            } catch {
              // Fallback: embed_url conflict on a different slug — skip safely
              await db
                .insert(videosTable)
                .values(
                  chunk.map((v) => ({
                    slug: v.slug, title: v.title, description: v.description,
                    embed_url: v.embed_url, thumbnail_url: v.thumbnail_url,
                    duration_seconds: v.duration_seconds, duration_text: v.duration_text,
                    views: v.views, likes: v.likes, quality_label: v.quality_label,
                    category: v.category, studio: v.studio, release_year: v.release_year,
                    tags: v.tags, pornstars: v.pornstars, status: v.status,
                  })),
                )
                .onConflictDoNothing();
            }
          }
          savedThisPage      = withEmbed.length;
          keywordTotalSaved += savedThisPage;
          grandTotalSaved   += savedThisPage;
        }
      }

      process.stdout.write(
        `[KEYWORD FILL]   "${keyword}" p=${page}/${pagesPerKeyword} — ` +
        `+${savedThisPage} saved (keyword: ${keywordTotalSaved} | grand total: ${grandTotalSaved})\n`,
      );
      logger.info(
        { keyword, page, pagesPerKeyword, foundOnPage: newVideos.length, savedThisPage, keywordTotalSaved, grandTotalSaved },
        "scrapeByKeywords: page saved",
      );

      // 500ms safety throttle — prevents IP rate-limiting by upstream source
      await delay(DEEP_CRAWL_DELAY_MS);
    }
  }

  process.stdout.write(
    `\n[KEYWORD FILL] ✅ Keyword search backfill complete — ` +
    `${grandTotalSaved} total whitelisted videos saved across ${keywords.length} keywords\n\n`,
  );
  logger.info(
    { grandTotalSaved, keywordCount: keywords.length, pagesPerKeyword },
    "scrapeByKeywords: complete",
  );
}

// ---------------------------------------------------------------------------
// scrapeByPerformers — targeted ?q= search crawl for all 33 whitelisted performers
// ---------------------------------------------------------------------------

/**
 * Crawls HQporner using ?q=<performer name> for every entry in WHITELISTED_PERFORMERS.
 * isWhitelisted() is intentionally bypassed — the performer name is the relevance gate.
 * Each video has the performer injected into its pornstars[] before upsert.
 * onConflictDoUpdate on slug overwrites tags + pornstars for already-indexed rows.
 */
export async function scrapeByPerformers(): Promise<void> {
  process.stdout.write(
    `\n[PERFORMER FILL] ▶ Starting RECURSIVE performer backfill — ${WHITELISTED_PERFORMERS.length} performers · crawling all pages until exhausted\n` +
    `   Using HQporner search: https://hqporner.com/?q=<performer>&p=<page>\n` +
    `   isWhitelisted() BYPASSED — performer name is the relevance filter · 500ms throttle per page\n\n`,
  );
  logger.info(
    { performers: WHITELISTED_PERFORMERS.length },
    "scrapeByPerformers: starting recursive performer search crawl",
  );

  let grandTotalSaved = 0;

  for (const performer of WHITELISTED_PERFORMERS) {
    let performerTotalSaved = 0;

    // Normalise "Dredd xxx" variants so the ?q= search actually finds results
    const nameLower = performer.name.toLowerCase().replace(/\s+/g, "");
    const queryName = nameLower === "dreddxxx" ? "Dredd xxx" : performer.name;
    const encodedQuery = encodeURIComponent(queryName).replace(/%20/g, "+");

    process.stdout.write(
      `[PERFORMER FILL] ── Performer: "${performer.name}" — searching ?q=${encodedQuery}\n`,
    );
    logger.info({ performer: performer.name, query: encodedQuery }, "scrapeByPerformers: searching performer");

    const seenSlugs = new Set<string>();

    // Recursive loop — increment page until the source returns empty/404.
    // No upper-page cap: we fetch every historical video for this performer.
    for (let page = 1; ; page++) {
      const searchUrl = `${BASE_URL}/?q=${encodedQuery}&p=${page}`;
      const html = await fetchHtml(searchUrl);

      if (!html) {
        process.stdout.write(
          `[PERFORMER FILL]   "${performer.name}" p=${page} — fetch failed/404. ` +
          `Performer exhausted (${performerTotalSaved} saved). Moving to next.\n`,
        );
        logger.info({ performer: performer.name, page, performerTotalSaved }, "scrapeByPerformers: exhausted (fetch failed)");
        break;
      }

      const pageVideos = extractVideosFromListing(html);

      if (pageVideos.length === 0) {
        process.stdout.write(
          `[PERFORMER FILL]   "${performer.name}" p=${page} — 0 results. ` +
          `Performer exhausted (${performerTotalSaved} saved). Moving to next.\n`,
        );
        logger.info({ performer: performer.name, page, performerTotalSaved }, "scrapeByPerformers: exhausted (empty page)");
        break;
      }

      // Deduplicate within this performer's crawl
      const newVideos: ScrapedVideo[] = [];
      for (const v of pageVideos) {
        if (!seenSlugs.has(v.slug)) {
          seenSlugs.add(v.slug);
          newVideos.push(v);
        }
      }

      let savedThisPage = 0;
      if (newVideos.length > 0) {
        const enriched = await enrichWithDetailPages(newVideos);

        // Strict curation match — only keep videos where the performer's name is
        // actually present in the detail page's parsed pornstars[] array.
        // Do NOT blindly inject the performer's name; this prevents false
        // associations (e.g. a search for "Andi James" returning videos that
        // don't actually feature her).
        //
        // Special case — "Dredd xxx": source sites list him as plain "Dredd",
        // so we accept any of "dredd", "dredd xxx", or "dreddxxx" as a match
        // so his full archive gets indexed and linked under "Dredd xxx".
        // Strict exact-word match: trim + lowercase-equal on both sides.
        // This prevents partial-substring false positives (e.g. "James" matching
        // "Andi James", or "Raine" matching "Wendy Raine") from ever landing in
        // the DB via the performer crawl.
        const performerLower = performer.name.trim().toLowerCase();
        const isDredd = performerLower === "dredd xxx";
        const withEmbed = enriched.filter(
          (v) =>
            isRealEmbedUrl(v.embed_url) &&
            v.pornstars.some((p) => {
              const pl = p.trim().toLowerCase();
              if (isDredd) return pl === "dredd" || pl === "dredd xxx" || pl === "dreddxxx";
              return pl === performerLower;
            }),
        );

        if (withEmbed.length > 0) {
          // Deduplicate partial/substring performer names before any DB write
          for (const v of withEmbed) {
            v.pornstars = dedupePerformerNames(v.pornstars);
          }

          for (let bi = 0; bi < withEmbed.length; bi += BATCH_SIZE) {
            const chunk = withEmbed.slice(bi, bi + BATCH_SIZE);
            try {
              await db
                .insert(videosTable)
                .values(
                  chunk.map((v) => ({
                    slug: v.slug, title: v.title, description: v.description,
                    embed_url: v.embed_url, thumbnail_url: v.thumbnail_url,
                    duration_seconds: v.duration_seconds, duration_text: v.duration_text,
                    views: v.views, likes: v.likes, quality_label: v.quality_label,
                    category: v.category, studio: v.studio, release_year: v.release_year,
                    tags: v.tags, pornstars: v.pornstars, status: v.status,
                  })),
                )
                .onConflictDoUpdate({
                  target: videosTable.slug,
                  set: {
                    tags:      sql`excluded.tags`,
                    pornstars: sql`excluded.pornstars`,
                  },
                });
            } catch {
              // Fallback: embed_url conflict on a different slug — skip safely
              await db
                .insert(videosTable)
                .values(
                  chunk.map((v) => ({
                    slug: v.slug, title: v.title, description: v.description,
                    embed_url: v.embed_url, thumbnail_url: v.thumbnail_url,
                    duration_seconds: v.duration_seconds, duration_text: v.duration_text,
                    views: v.views, likes: v.likes, quality_label: v.quality_label,
                    category: v.category, studio: v.studio, release_year: v.release_year,
                    tags: v.tags, pornstars: v.pornstars, status: v.status,
                  })),
                )
                .onConflictDoNothing();
            }
          }
          savedThisPage        = withEmbed.length;
          performerTotalSaved += savedThisPage;
          grandTotalSaved     += savedThisPage;
        }
      }

      process.stdout.write(
        `[PERFORMER FILL]   "${performer.name}" p=${page} — ` +
        `+${savedThisPage} saved (performer: ${performerTotalSaved} | grand total: ${grandTotalSaved})\n`,
      );
      logger.info(
        { performer: performer.name, page, foundOnPage: newVideos.length, savedThisPage, performerTotalSaved, grandTotalSaved },
        "scrapeByPerformers: page saved",
      );

      // 500ms safety throttle — prevents IP rate-limiting by upstream source
      await delay(DEEP_CRAWL_DELAY_MS);
    }
  }

  process.stdout.write(
    `\n[PERFORMER FILL] ✅ Recursive performer backfill complete — ` +
    `${grandTotalSaved} total videos saved across ${WHITELISTED_PERFORMERS.length} performers\n\n`,
  );
  logger.info(
    { grandTotalSaved, performerCount: WHITELISTED_PERFORMERS.length },
    "scrapeByPerformers: complete",
  );
}

// ---------------------------------------------------------------------------
// scrapeGalaxyPorn — listing + detail pages from galaxyporn.net (MissaX / Taboo 4K)
// ---------------------------------------------------------------------------

const GP_BASE     = "https://galaxyporn.net";
const GP_DELAY_MS = 600;
const GP_SEARCHES = ["Taboo", "Missax"];

/**
 * Extract the embed iframe src and metadata from a galaxyporn.net detail page.
 *
 * Embed URL resolution priority:
 *   1. <iframe src> that is an external third-party player (not galaxyporn.net)
 *      or an explicit /embed/ path on galaxyporn.net itself.
 *   2. <meta property="og:video"> / <meta property="og:video:url"> — only
 *      accepted when the URL does NOT point back to the galaxyporn.net page.
 */
function extractGalaxyPornMeta(html: string): {
  embedUrl: string | null;
  durationSeconds: number;
  tags: string[];
  performers: string[];
} {
  const $ = cheerio.load(html);

  // Embed URL — first <iframe src> that is an external player
  let embedUrl: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("iframe[src]").each((_: number, el: any) => {
    if (embedUrl) return false as unknown as void;
    const s = $(el).attr("src") ?? "";
    if (!s) return;
    const abs = s.startsWith("//") ? `https:${s}` : s;
    if (!abs.startsWith("http")) return;
    // Accept galaxyporn.net only if it's an /embed/ path
    if (abs.includes("galaxyporn.net") && !abs.includes("/embed")) return;
    embedUrl = abs;
  });

  // OG video fallback — reject bare galaxyporn.net page URLs
  if (!embedUrl) {
    const og =
      $("meta[property='og:video']").attr("content") ??
      $("meta[property='og:video:url']").attr("content") ??
      null;
    if (og && !og.match(/^https?:\/\/galaxyporn\.net\/(?!embed)/)) {
      embedUrl = og;
    }
  }

  // Duration — OG/video meta first, then visible text
  const durationRaw =
    $("meta[property='video:duration']").attr("content") ??
    $("meta[name='duration']").attr("content") ??
    "";
  let durationSeconds = parseInt(durationRaw, 10) || 0;
  if (!durationSeconds) {
    const durText = $(".duration, .video-duration, span.time, .video-time, [class*='duration'], .runtime")
      .first().text().trim();
    if (durText) durationSeconds = parseDurationText(durText);
  }

  // Tags — category and tag anchor links from the page
  const tags: string[] = [];
  const tagSeen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href*='/category/'], a[href*='/tag/']").each((_: number, el: any) => {
    const href = $(el).attr("href") ?? "";
    // Skip performer/studio links that share category/tag paths
    if (
      href.includes("/pornstar/") || href.includes("/model/") ||
      href.includes("/actress/")  || href.includes("/studio/")
    ) return;
    const t = $(el).text().trim().toLowerCase();
    if (!t || t.length < 2 || t.length > 40) return;
    if (!tagSeen.has(t)) { tagSeen.add(t); tags.push(t); }
  });

  // Performers — model/pornstar profile links
  const performers: string[] = [];
  const perfSeen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href*='/pornstar/'], a[href*='/model/'], a[href*='/models/'], a[href*='/actress/']").each((_: number, el: any) => {
    const name = $(el).text().trim();
    // Require ≥ 3 characters — filters out 2-char nav artefacts like "Vi"
    if (name && name.length >= 3 && !perfSeen.has(name)) {
      if (name.split(" ").length > 3 || name.length > 28) return;
      perfSeen.add(name);
      performers.push(name);
    }
  });

  return { embedUrl, durationSeconds, tags, performers };
}

/**
 * Scrape galaxyporn.net for Taboo and MissaX 4K content.
 *
 * Searches both "Taboo" and "Missax" query terms, crawling up to `pagesCount`
 * WordPress paged listing pages per search. Detail pages are fetched to
 * extract the real <iframe src> embed URL, duration, tags, and performers.
 * Uses onConflictDoUpdate so repeat runs refresh view counts rather than
 * silently discarding updates.
 *
 * @param pagesCount Listing pages to crawl per search term (default 3).
 */
export async function scrapeGalaxyPorn(pagesCount = 3, queries: string[] = GP_SEARCHES): Promise<void> {
  logger.info({ pagesCount, searches: queries }, "scrapeGalaxyPorn: starting");
  process.stdout.write(
    `\n[GALAXYPORN] Starting scrape — up to ${pagesCount} pages × ${queries.length} search terms\n`,
  );

  const seenSlugs = new Set<string>();
  let totalSaved  = 0;

  for (const query of queries) {
    process.stdout.write(`[GALAXYPORN] ── Search: "${query}"\n`);

    for (let page = 1; page <= pagesCount; page++) {
      // WordPress paged search: page 1 = /?s=query, page N = /page/N/?s=query
      const listUrl = page === 1
        ? `${GP_BASE}/?s=${encodeURIComponent(query)}`
        : `${GP_BASE}/page/${page}/?s=${encodeURIComponent(query)}`;

      const html = await fetchHtmlFrom(listUrl, GP_BASE);
      if (!html) {
        process.stdout.write(`[GALAXYPORN] "${query}" page ${page} — fetch failed, skipping\n`);
        await delay(GP_DELAY_MS);
        continue;
      }

      const $ = cheerio.load(html);
      const videoLinks: { href: string; title: string; thumb: string; durText: string }[] = [];
      const linkSeen = new Set<string>();

      // Tier 1 — known WordPress tube-site card selectors
      const CARD_SELECTORS = [
        "article.post",
        ".video-item",
        ".thumb-item",
        ".video-block",
        ".grid-item",
        "div[class*='video-card']",
        "div[class*='thumb']",
        ".item",
      ];

      for (const cardSel of CARD_SELECTORS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $(cardSel).each((_: number, el: any) => {
          const card   = $(el);
          const linkEl = card.find("a[href]").first();
          const href   = linkEl.attr("href") ?? "";
          if (!href) return;
          const abs = href.startsWith("http") ? href : `${GP_BASE}${href}`;
          if (!abs.includes("galaxyporn.net")) return;
          if (abs === GP_BASE || abs === `${GP_BASE}/`) return;
          if (linkSeen.has(abs)) return;

          const imgEl = card.find("img").first();
          let thumb   = imgEl.attr("data-src") ?? imgEl.attr("data-original") ?? imgEl.attr("src") ?? "";
          if (thumb.startsWith("/"))  thumb = `${GP_BASE}${thumb}`;
          if (thumb.startsWith("//")) thumb = `https:${thumb}`;
          if (!thumb.startsWith("http")) return;

          const title =
            card.find(".title, .video-title, h1, h2, h3").first().text().trim() ||
            imgEl.attr("alt")?.trim() ||
            linkEl.attr("title")?.trim() ||
            "";
          if (!title) return;

          const durText = card.find(".duration, .time, [class*='dur'], .runtime").first().text().trim();

          linkSeen.add(abs);
          videoLinks.push({ href: abs, title, thumb, durText });
        });
        if (videoLinks.length > 0) break;
      }

      // Tier 2 — broad fallback: any anchor wrapping an img on the same domain
      if (videoLinks.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $("a[href]").each((_: number, el: any) => {
          const a    = $(el);
          const href = a.attr("href") ?? "";
          if (!href) return;
          const abs = href.startsWith("http") ? href : `${GP_BASE}${href}`;
          if (!abs.includes("galaxyporn.net")) return;
          if (abs === GP_BASE || abs === `${GP_BASE}/`) return;
          if (abs.includes("/?s=") || abs.includes("/page/")) return;
          if (linkSeen.has(abs)) return;

          const imgEl = a.find("img").first();
          if (!imgEl.length) return;
          let thumb = imgEl.attr("data-src") ?? imgEl.attr("src") ?? "";
          if (thumb.startsWith("/"))  thumb = `${GP_BASE}${thumb}`;
          if (thumb.startsWith("//")) thumb = `https:${thumb}`;
          if (!thumb.startsWith("http")) return;

          const title = imgEl.attr("alt")?.trim() || a.attr("title")?.trim() || "";
          if (!title) return;
          linkSeen.add(abs);
          videoLinks.push({ href: abs, title, thumb, durText: "" });
        });
      }

      if (videoLinks.length === 0) {
        process.stdout.write(`[GALAXYPORN] "${query}" page ${page} — no candidates found\n`);
        await delay(GP_DELAY_MS);
        continue;
      }

      // Build candidate objects from listing data
      const candidates: ScrapedVideo[] = [];
      for (const { href, title, thumb, durText } of videoLinks) {
        const durationSeconds = parseDurationText(durText);
        if (durationSeconds > 0 && durationSeconds < MIN_DURATION_SECONDS) continue;

        const pathSlug = href
          .replace(/^https?:\/\/[^/]+/, "")
          .replace(/^\//, "")
          .replace(/\/$/, "");
        const rawSlug = `gp-${slugify(pathSlug || title)}`.slice(0, 120);
        if (seenSlugs.has(rawSlug)) continue;
        seenSlugs.add(rawSlug);

        const familyKeyword = detectFamilyKeyword(title, []);

        candidates.push({
          slug:             rawSlug,
          title,
          description:      null,
          source_url:       href,
          embed_url:        href,   // overwritten from detail-page iframe below
          thumbnail_url:    thumb,
          duration_seconds: durationSeconds,
          duration_text:    durText,
          views:            simulateViews(0),
          likes:            0,
          quality_label:    (() => {
            const lc = title.toLowerCase();
            const initialTags = familyKeyword ? [familyKeyword, "taboo"] : ["taboo"];
            const has4K = lc.includes("4k") || lc.includes("2160p") ||
              initialTags.map((t) => t.toLowerCase()).includes("4k") ||
              initialTags.map((t) => t.toLowerCase()).includes("2160p");
            return (has4K ? "4K" : "1080p") as "4K" | "1080p";
          })(),
          category:         familyKeyword ? "family" : "taboo",
          studio:           null,
          release_year:     simulateReleaseYear(),
          tags:             familyKeyword ? [familyKeyword, "taboo"] : ["taboo"],
          pornstars:        [],
          status:           "published",
          _familyKeyword:   familyKeyword,
        });
      }

      logger.info({ query, page, candidates: candidates.length }, "scrapeGalaxyPorn: listing page parsed");

      // Dedup — skip slugs already in DB
      let newCandidates = candidates;
      try {
        const existingRows = await db
          .select({ slug: videosTable.slug })
          .from(videosTable)
          .where(inArray(videosTable.slug, candidates.map((v) => v.slug)));
        const existingSlugs = new Set(existingRows.map((r: { slug: string }) => r.slug));
        newCandidates = candidates.filter((v) => !existingSlugs.has(v.slug));
      } catch (dbErr) {
        logger.warn({ dbErr }, "scrapeGalaxyPorn: dedup check failed — proceeding with all candidates");
      }

      let savedThisPage = 0;
      for (const v of newCandidates) {
        const detailHtml = await fetchHtmlFrom(v.source_url, GP_BASE);
        if (!detailHtml) { await delay(GP_DELAY_MS); continue; }

        const {
          embedUrl,
          durationSeconds: detailDur,
          tags:            detailTags,
          performers,
        } = extractGalaxyPornMeta(detailHtml);

        if (!embedUrl) {
          logger.warn({ slug: v.slug }, "scrapeGalaxyPorn: no iframe embed URL found — skipping");
          await delay(200);
          continue;
        }

        // Merge listing tags with detail-page tags
        const tagSet = new Set<string>(v.tags);
        for (const t of detailTags) tagSet.add(t);

        // Performers come exclusively from explicit HTML links on the detail page.
        // Dedup partial substrings before persisting.
        const rawPornstars = performers;
        const mergedTags = Array.from(tagSet);
        const titleLcQ = v.title.toLowerCase();
        const has4KDetail = titleLcQ.includes("4k") || titleLcQ.includes("2160p") ||
          mergedTags.some((t) => t.toLowerCase() === "4k" || t.toLowerCase() === "2160p");
        const enriched: ScrapedVideo = {
          ...v,
          embed_url:        embedUrl,
          duration_seconds: detailDur > 0 ? detailDur : v.duration_seconds,
          duration_text:    detailDur > 0
            ? `${Math.floor(detailDur / 60)}m ${detailDur % 60}s`
            : v.duration_text,
          tags:          mergedTags,
          quality_label: has4KDetail ? "4K" : "1080p",
          // Deduplicate partial/substring names before persisting
          pornstars: dedupePerformerNames(rawPornstars),
          studio:    v.studio ?? pickSimulatedStudio(v._familyKeyword ?? null),
        };

        // onConflictDoUpdate so repeat runs refresh view counts
        await upsertBatchWithViewUpdate([enriched]);
        savedThisPage++;
        await delay(400);
      }

      totalSaved += savedThisPage;
      process.stdout.write(
        `[GALAXYPORN] "${query}" page ${page}/${pagesCount} — +${savedThisPage} saved (${totalSaved} total)\n`,
      );
      logger.info({ query, page, savedThisPage, totalSaved }, "scrapeGalaxyPorn: page complete");
      await delay(GP_DELAY_MS);
    }
  }

  process.stdout.write(`\n[GALAXYPORN] ✅ Complete — ${totalSaved} videos saved\n\n`);
  logger.info({ totalSaved }, "scrapeGalaxyPorn: complete");
}

// ---------------------------------------------------------------------------
// FXPornHD scraper — unrestricted third source
// ---------------------------------------------------------------------------

const FX_BASE     = "https://fxpornhd.com";
const FX_DELAY_MS = 600;

// ---------------------------------------------------------------------------
// FXPornHD studio → category/tag map  (module-level so both extract & helpers share it)
// ---------------------------------------------------------------------------

/**
 * Comprehensive studio taxonomy for FXPornHD bracketed-prefix titles.
 *
 * Keys are normalised (lowercase, spaces/hyphens/underscores stripped) so they
 * match `studioMatch[1].toLowerCase().replace(/[\s\-_]/g, "")`.
 *
 * Each entry carries:
 *   categories — ordered list; first entry becomes the video's primary category.
 *   tags       — all content tags to inject (merged with HTML-derived tags).
 */
const FX_STUDIO_TAXONOMY: Record<string, { categories: string[]; tags: string[] }> = {
  // ── Milf / Stepmom ────────────────────────────────────────────────────────
  analmom:              { categories: ["anal"],       tags: ["anal", "milf", "stepmom", "mature"] },
  mommygotboobs:        { categories: ["milf"],       tags: ["milf", "big boobs", "mature"] },
  momsteachsex:         { categories: ["milf"],       tags: ["milf", "taboo", "stepmom"] },
  momsinsex:            { categories: ["milf"],       tags: ["milf", "taboo", "mature"] },
  pervmom:              { categories: ["milf"],       tags: ["milf", "stepmom", "taboo"] },
  pervmoms:             { categories: ["milf"],       tags: ["milf", "stepmom", "taboo"] },
  brattymilf:           { categories: ["milf"],       tags: ["milf", "family", "mature"] },
  brattyMILF:           { categories: ["milf"],       tags: ["milf", "family", "mature"] },
  myfavoritemilf:       { categories: ["milf"],       tags: ["milf", "mature"] },
  mylf:                 { categories: ["milf"],       tags: ["milf", "mature", "hd"] },
  milfhunter:           { categories: ["milf"],       tags: ["milf", "amateur", "mature"] },
  momxxx:               { categories: ["milf"],       tags: ["milf", "taboo", "stepmom"] },
  stepmomlessons:       { categories: ["milf"],       tags: ["milf", "stepmom", "taboo"] },

  // ── Family / Taboo ────────────────────────────────────────────────────────
  sexmex:               { categories: ["taboo"],      tags: ["family", "taboo", "stepmom", "latina"] },
  puretaboo:            { categories: ["taboo"],      tags: ["taboo", "family", "fetish"] },
  familystrokes:        { categories: ["family"],     tags: ["family", "taboo", "stepsis"] },
  brattysis:            { categories: ["taboo"],      tags: ["taboo", "stepsis", "family"] },
  dadcrush:             { categories: ["taboo"],      tags: ["family", "taboo", "stepdad"] },
  filthyfamily:         { categories: ["family"],     tags: ["family", "taboo"] },
  myfamilypies:         { categories: ["family"],     tags: ["family", "taboo", "amateur"] },
  mypervyfamily:        { categories: ["family"],     tags: ["family", "taboo"] },
  bffs:                 { categories: ["erotic"],     tags: ["group", "amateur", "teen"] },
  daughterswap:         { categories: ["taboo"],      tags: ["family", "taboo"] },
  momswap:              { categories: ["taboo"],      tags: ["family", "taboo", "milf"] },
  auntswap:             { categories: ["taboo"],      tags: ["family", "taboo", "milf"] },
  familytherapy:        { categories: ["taboo"],      tags: ["taboo", "family"] },
  stepsiblingscaught:   { categories: ["taboo"],      tags: ["taboo", "stepsis", "family"] },

  // ── Anal ──────────────────────────────────────────────────────────────────
  evilangel:            { categories: ["anal"],       tags: ["anal", "hd", "hardcore"] },
  tushy:                { categories: ["anal"],       tags: ["anal", "erotic", "hd"] },
  tushyraw:             { categories: ["anal"],       tags: ["anal", "amateur", "hd"] },
  assholefever:         { categories: ["anal"],       tags: ["anal", "hardcore"] },
  analonly:             { categories: ["anal"],       tags: ["anal", "hd"] },

  // ── Lesbian ───────────────────────────────────────────────────────────────
  twistys:              { categories: ["erotic"],     tags: ["erotic", "solo", "lesbian"] },
  loveher:              { categories: ["lesbian"],    tags: ["lesbian", "erotic"] },
  girlfriendsfilms:     { categories: ["lesbian"],    tags: ["lesbian", "erotic", "hd"] },
  sweetheartvideo:      { categories: ["lesbian"],    tags: ["lesbian", "erotic"] },
  girlsway:             { categories: ["lesbian"],    tags: ["lesbian", "erotic", "hd"] },
  tribbing:             { categories: ["lesbian"],    tags: ["lesbian", "erotic"] },
  slayed:               { categories: ["lesbian"],    tags: ["lesbian", "erotic", "hd"] },
  nubilefilms:          { categories: ["erotic"],     tags: ["erotic", "lesbian", "hd"] },

  // ── BBC / Interracial ─────────────────────────────────────────────────────
  blacked:              { categories: ["erotic"],     tags: ["bbc", "interracial", "erotic"] },
  blackedraw:           { categories: ["erotic"],     tags: ["bbc", "interracial", "amateur"] },
  cuckoldsessions:      { categories: ["erotic"],     tags: ["cuckold", "erotic", "bbc"] },

  // ── Amateur / Casting ─────────────────────────────────────────────────────
  shesnew:              { categories: ["AMATEUR", "CASTING"],               tags: ["shesnew", "amateur", "casting"] },
  shoplyfter:           { categories: ["SHOPLYFTER", "EROTIC"],             tags: ["shoplyfter", "erotic"] },
  sislovesme:           { categories: ["FAMILY", "TABOO", "STEP SISTER"],   tags: ["sislovesme", "stepsister", "taboo"] },
  usepov:               { categories: ["FREEUSE", "POV", "TABOO"],          tags: ["usepov", "freeuse", "pov", "taboo"] },
  realitykings:         { categories: ["erotic"],     tags: ["hd", "erotic", "amateur"] },
  mofos:                { categories: ["amateur"],    tags: ["amateur", "public", "hd"] },
  netvideogirls:        { categories: ["amateur"],    tags: ["amateur", "casting"] },
  stranded:             { categories: ["amateur"],    tags: ["amateur", "outdoor"] },

  // ── BDSM / Fetish ─────────────────────────────────────────────────────────
  kink:                 { categories: ["bdsm"],       tags: ["bdsm", "fetish", "bondage"] },
  fantasticfetiches:    { categories: ["fetish"],     tags: ["fetish", "bdsm"] },
  sissylogs:            { categories: ["fetish"],     tags: ["fetish", "sissy", "femdom"] },
  newmfx:               { categories: ["fetish"],     tags: ["fetish", "brazil"] },
  burningangel:         { categories: ["erotic"],     tags: ["alternative", "tattoo", "punk"] },

  // ── Big / Curvy ───────────────────────────────────────────────────────────
  score:                { categories: ["erotic"],     tags: ["big boobs", "erotic", "mature"] },
  scoreland:            { categories: ["erotic"],     tags: ["big boobs", "busty", "mature"] },

  // ── Premium / Studio Erotic ───────────────────────────────────────────────
  brazzers:             { categories: ["erotic"],     tags: ["hd", "erotic", "big boobs"] },
  brazzersExxtra:       { categories: ["erotic"],     tags: ["hd", "onlyfans", "big boobs"] },
  brazzerseexxtra:      { categories: ["erotic"],     tags: ["hd", "onlyfans", "big boobs"] },
  pornworld:            { categories: ["erotic"],     tags: ["hd", "onlyfans", "erotic"] },
  bangbros:             { categories: ["erotic"],     tags: ["hd", "erotic", "big ass"] },
  bangbroschannel:      { categories: ["erotic"],     tags: ["hd", "erotic", "big ass"] },
  wicked:               { categories: ["erotic"],     tags: ["erotic", "hd", "storyline"] },
  digitalplayground:    { categories: ["erotic"],     tags: ["hd", "erotic", "storyline"] },
  devilsfilm:           { categories: ["erotic"],     tags: ["erotic", "hd", "taboo"] },
  vixen:                { categories: ["erotic"],     tags: ["erotic", "hd", "glamour"] },
  deeper:               { categories: ["anal"],       tags: ["erotic", "hd", "anal"] },
  teamskeet:            { categories: ["erotic"],     tags: ["erotic", "teen", "hd"] },
  ddfnetwork:           { categories: ["erotic"],     tags: ["erotic", "hd", "european"] },
  sexart:               { categories: ["erotic"],     tags: ["erotic", "artistic", "hd"] },
  metrohd:              { categories: ["erotic"],     tags: ["erotic", "hd", "big boobs"] },
  penthouse:            { categories: ["erotic"],     tags: ["erotic", "solo", "glamour"] },
  vivid:                { categories: ["erotic"],     tags: ["erotic", "hd"] },
  playboy:              { categories: ["erotic"],     tags: ["erotic", "solo", "glamour"] },

  // ── Office / Uniform ──────────────────────────────────────────────────────
  naughtyoffice:        { categories: ["erotic"],     tags: ["office", "erotic", "uniform"] },
  naughtyamerica:       { categories: ["erotic"],     tags: ["erotic", "hd", "uniform"] },

  // ── POV ───────────────────────────────────────────────────────────────────
  povmaster:            { categories: ["erotic"],     tags: ["pov", "erotic"] },
  povlife:              { categories: ["erotic"],     tags: ["pov", "erotic", "amateur"] },

  // ── Brazzers correct lowercase key (brazzersExxtra key above is broken) ──
  brazzersexxtra:       { categories: ["erotic"],     tags: ["hd", "erotic", "big boobs"] },

  // ── Step-family / Taboo (additional studios) ─────────────────────────────
  missax:               { categories: ["taboo"],      tags: ["taboo", "family", "erotic"] },
  mysistershotfriend:   { categories: ["taboo"],      tags: ["taboo", "stepsis", "friend"] },
  neighboraffair:       { categories: ["erotic"],     tags: ["erotic", "milf", "cheating"] },
  fillupmymom:          { categories: ["milf"],       tags: ["milf", "stepmom", "creampie"] },
  hijabmylfs:           { categories: ["milf"],       tags: ["milf", "hijab", "mature", "taboo"] },

  // ── Teen / Young ──────────────────────────────────────────────────────────
  princesscum:          { categories: ["erotic"],     tags: ["erotic", "teen", "hd"] },
  newsensations:        { categories: ["erotic"],     tags: ["erotic", "hd", "big boobs"] },
  oyeloca:              { categories: ["erotic"],     tags: ["erotic", "latina", "amateur"] },

  // ── Big Boobs / Creampie ──────────────────────────────────────────────────
  bigtitcreampie:       { categories: ["erotic"],     tags: ["big boobs", "creampie", "erotic"] },

  // ── Alternative / Euro ────────────────────────────────────────────────────
  femalefaketaxi:       { categories: ["erotic"],     tags: ["erotic", "pov", "euro", "fake taxi"] },

  // ── Network / Premium ─────────────────────────────────────────────────────
  rkprime:              { categories: ["erotic"],     tags: ["erotic", "hd", "amateur"] },
  onlyfans:             { categories: ["onlyfans"],   tags: ["onlyfans", "amateur", "hd"] },
  onlytarts:            { categories: ["erotic"],     tags: ["erotic", "hd"] },
};

/**
 * Derive a meaningful primary category for an FXPornHD video.
 *
 * Priority order:
 *  1. Bracketed studio prefix  → first entry from FX_STUDIO_TAXONOMY[].categories
 *  2. Title keywords           → stepmom, milf, family, anal, …
 *  3. Already-derived tags
 *  4. "erotic" fallback        — never returns "general"
 */
function inferFxCategoryFromTitle(title: string, tags: string[]): string {
  // 1. Bracketed studio prefix → use taxonomy categories array
  const studioMatch = title.match(/^\[([^\]]+)\]/);
  if (studioMatch) {
    const studioNorm = studioMatch[1].toLowerCase().replace(/[\s\-_]/g, "");
    const studioEntry = FX_STUDIO_TAXONOMY[studioNorm];
    if (studioEntry && studioEntry.categories.length > 0) {
      return studioEntry.categories[0];     // first category is the primary one
    }
  }

  // 2. Title keywords
  const lc = title.toLowerCase();
  if (/\b(stepmom|stepmother|step\s*mom)\b/.test(lc)) return "stepmom";
  if (/\b(milf|hot\s*mom)\b/.test(lc))                 return "milf";
  if (/\b(family|taboo|incest)\b/.test(lc))             return "family";
  if (/\banal\b/.test(lc))                              return "anal";
  if (/\blesbian\b/.test(lc))                           return "lesbian";
  if (/\b(bbw|curvy|chubby)\b/.test(lc))                return "bbw";
  if (/\bcollege\b/.test(lc))                           return "college";
  if (/\bonlyfans\b/.test(lc))                          return "onlyfans";
  if (/\bbdsm|bondage\b/.test(lc))                      return "bdsm";

  // 3. Existing tags
  const PRIORITY_TAGS = ["milf","stepmom","family","taboo","anal","lesbian","bbw","college","onlyfans","erotic"];
  for (const t of tags) {
    if (PRIORITY_TAGS.includes(t.toLowerCase())) return t.toLowerCase();
  }

  // 4. Fallback — never "general"
  return "erotic";
}

/**
 * Parse the detail page of an fxpornhd.com video.
 *
 * Extracts:
 *  - embedUrl   — the <iframe src> (prefers player.fxpornhd.com/embed/ or any
 *                 other https embed player; falls back to the first iframe src)
 *  - durationSeconds — from OG/meta or on-page text
 *  - tags       — links under /category/ or /tag/
 *  - performers — links under /pornstar/, /model/, /models/, or /actress/
 *                 (NO title heuristics or hyphen-splitting — HTML links only)
 */
function extractFXPornHDMeta(html: string, title = ""): {
  embedUrl: string;
  durationSeconds: number;
  tags: string[];
  performers: string[];
} {
  const $ = cheerio.load(html);

  // ── Embed URL ──────────────────────────────────────────────────────────────
  let embedUrl = "";

  // Priority 1: dedicated FXPornHD player or known open embed players
  const PREFERRED_PLAYER_PATTERNS = [
    "player.fxpornhd.com/embed",
    "fxpornhd.com/embed",
    "embedsb.com",
    "doodstream.com/e/",
    "streamtape.com/e/",
    "mixdrop.co/e/",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("iframe[src]").each((_: number, el: any) => {
    if (embedUrl) return; // already found
    const src = $(el).attr("src") ?? "";
    if (!src.startsWith("http")) return;
    if (PREFERRED_PLAYER_PATTERNS.some((p) => src.includes(p))) {
      embedUrl = src;
    }
  });

  // Priority 2: any https iframe
  if (!embedUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $("iframe[src]").each((_: number, el: any) => {
      if (embedUrl) return;
      const src = $(el).attr("src") ?? "";
      if (src.startsWith("https://")) embedUrl = src;
    });
  }

  // Priority 3: data-src (lazy-loaded iframes)
  if (!embedUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $("iframe[data-src]").each((_: number, el: any) => {
      if (embedUrl) return;
      const src = $(el).attr("data-src") ?? "";
      if (src.startsWith("http")) embedUrl = src;
    });
  }

  // ── Duration ──────────────────────────────────────────────────────────────
  const durationRaw =
    $("meta[property='video:duration']").attr("content") ??
    $("meta[name='duration']").attr("content") ??
    "";
  let durationSeconds = parseInt(durationRaw, 10) || 0;
  if (!durationSeconds) {
    const durText = $(
      ".duration, .video-duration, span.time, .video-time, [class*='duration'], .runtime",
    )
      .first()
      .text()
      .trim();
    if (durText) durationSeconds = parseDurationText(durText);
  }

  // ── Tags, studio mapping & title classifiers ─────────────────────────────

  const FX_TAG_BLOCKLIST = new Set([
    "categories", "#categories", "tags", "#tags", "fxpornhd", "hd porn",
    "porn", "free porn", "sex", "video", "videos", "xxx", "adult", "tube",
    "watch", "online", "free", "full", "general",
  ]);
  const tags: string[] = [];
  const tagSeen = new Set<string>();

  // Step 1 — fxpornhd.com uses a .tags-list container whose links have:
  //   • Category hrefs: /big-ass/  /taboo/  (direct slug — NO /category/ prefix)
  //   • Tag hrefs:      /s/big-tits/  /s/blowjobs/  (/s/ prefix)
  //   • Performer hrefs: /actor/river-lynn/  (skip — handled separately)
  //   • Year hrefs:      /s/2026/  (skip — pure year strings are noise)
  // Neither /tag/ nor /category/ ever appears in their URL structure, so the
  // classic tube-site selector finds zero matches.  Use .tags-list directly.
  const tagsListAnchors = $(".tags-list a[href]");
  if (tagsListAnchors.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tagsListAnchors.each((_: number, el: any) => {
      const href = $(el).attr("href") ?? "";
      // Skip performer links
      if (
        href.includes("/actor/")   || href.includes("/actress/") ||
        href.includes("/pornstar/")|| href.includes("/model/")
      ) return;
      // Skip year-only slugs like /s/2026/
      const lastSegment = href.replace(/\/$/, "").split("/").pop() ?? "";
      if (/^\d{4}(-\d+)?$/.test(lastSegment)) return;
      // Prefer the title attribute (clean display text) over inner text
      const raw = ($(el).attr("title") ?? $(el).text()).trim().toLowerCase().replace(/^#/, "");
      if (!raw || raw.length < 2 || raw.length > 40) return;
      if (FX_TAG_BLOCKLIST.has(raw)) return;
      if (!tagSeen.has(raw)) { tagSeen.add(raw); tags.push(raw); }
    });
  }

  // Step 1b — Fallback for other tube sites that DO use /tag/, /tags/, /category/
  if (tags.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $("a[href*='/tag/'], a[href*='/tags/'], a[href*='/category/']").each((_: number, el: any) => {
      const href = $(el).attr("href") ?? "";
      if (
        href.includes("/pornstar/") || href.includes("/model/") ||
        href.includes("/actress/")  || href.includes("/actor/") ||
        href.includes("/studio/")
      ) return;
      const t = $(el).text().trim().toLowerCase().replace(/^#/, "");
      if (!t || t.length < 2 || t.length > 40) return;
      if (FX_TAG_BLOCKLIST.has(t)) return;
      if (!tagSeen.has(t)) { tagSeen.add(t); tags.push(t); }
    });
  }

  // Step 2 — Bracketed studio → full taxonomy injection (FX_STUDIO_TAXONOMY).
  // Titles follow "[StudioName] ..." — normalise the prefix, look up the taxonomy,
  // then inject ALL declared tags (categories + tags). Always runs when a studio
  // prefix is found, regardless of what HTML tags were present.
  if (title) {
    const studioMatch = title.match(/^\[([^\]]+)\]/);
    if (studioMatch) {
      const studioNorm  = studioMatch[1].toLowerCase().replace(/[\s\-_]/g, "");
      const studioEntry = FX_STUDIO_TAXONOMY[studioNorm];
      if (studioEntry) {
        // Inject category tokens first so they appear at the front of the list
        for (const c of studioEntry.categories) {
          if (!tagSeen.has(c)) { tagSeen.add(c); tags.push(c); }
        }
        for (const t of studioEntry.tags) {
          if (!tagSeen.has(t)) { tagSeen.add(t); tags.push(t); }
        }
      }
    }
  }

  // Step 3 — Title keyword classifiers (only when still no useful tags).
  const usableTags = tags.filter((t) => !FX_TAG_BLOCKLIST.has(t));
  if (usableTags.length === 0 && title) {
    const hasKw = (kw: string) =>
      new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title);
    const TITLE_CLASSIFIERS: Array<{ test: () => boolean; add: string[] }> = [
      { test: () => hasKw("stepmom") || hasKw("stepmother"), add: ["stepmom", "family", "taboo"] },
      { test: () => hasKw("threesome") || hasKw("triad"),    add: ["threesome", "erotic"]        },
      { test: () => hasKw("curvy") || hasKw("bbw"),          add: ["bbw", "curvy"]               },
      { test: () => hasKw("milf") || hasKw("mom"),           add: ["milf", "mature"]             },
      { test: () => hasKw("college") || hasKw("student"),    add: ["college"]                    },
      { test: () => hasKw("ebony"),                          add: ["ebony"]                      },
      { test: () => hasKw("japanese") || hasKw("asian"),     add: ["japanese"]                   },
      { test: () => hasKw("onlyfans"),                       add: ["onlyfans"]                   },
      { test: () => hasKw("anal"),                           add: ["anal"]                       },
      { test: () => hasKw("lesbian"),                        add: ["lesbian"]                    },
      { test: () => hasKw("creampie"),                       add: ["creampie"]                   },
      { test: () => hasKw("blowjob") || hasKw("oral"),       add: ["blowjob", "oral"]            },
      { test: () => hasKw("interracial"),                    add: ["interracial"]                },
      { test: () => hasKw("bdsm") || hasKw("bondage"),       add: ["bdsm"]                      },
      { test: () => hasKw("massage"),                        add: ["massage", "erotic"]          },
      { test: () => hasKw("casting"),                        add: ["casting", "amateur"]         },
      { test: () => hasKw("cuckold"),                        add: ["cuckold", "erotic"]          },
    ];
    for (const { test, add } of TITLE_CLASSIFIERS) {
      if (test()) {
        for (const t of add) {
          if (!tagSeen.has(t)) { tagSeen.add(t); tags.push(t); }
        }
      }
    }
  }

  // ── Performers ────────────────────────────────────────────────────────────
  // Primary: HTML anchor links pointing to performer profile paths.
  // fxpornhd.com uses /actor/ — also handles /pornstar/, /model/, /actress/,
  // /star/ for other tube sites.
  // Fallback: parse the "[Studio] Performer1, Performer2 – Scene Title" title
  // pattern that fxpornhd.com uses consistently when no HTML links are found.

  // fxpornhd.com tags many category terms (e.g. "Big Tits", "Amateur") as
  // /actor/ links — these must be rejected so they don't pollute the performers list.
  const FX_PERFORMER_BLOCKLIST = new Set([
    "big tits", "big ass", "big boobs", "big cock", "big dick", "huge tits",
    "natural tits", "fake tits", "small tits", "flat chest",
    "teen", "teens", "amateur", "amateurs", "milf", "cougar", "mature",
    "blonde", "brunette", "redhead", "black hair",
    "latina", "asian", "ebony", "interracial", "bbc", "bbw",
    "anal", "lesbian", "threesome", "gangbang", "bdsm", "bondage",
    "fetish", "squirt", "squirting", "creampie", "facial", "cumshot",
    "blowjob", "handjob", "footjob", "orgy", "solo", "masturbation",
    "hd", "full hd", "4k", "1080p", "720p", "pov", "vr",
    "taboo", "family", "incest", "onlyfans", "casting", "roleplay",
    "stepmom", "stepsister", "stepbrother", "stepdad", "step mom",
    "step sister", "step brother", "step dad",
    "college", "uniform", "busty", "petite", "curvy", "chubby", "skinny",
    "lingerie", "stockings", "tattoo", "tattoos", "piercing",
  ]);

  const performers: string[] = [];
  const perfSeen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href*='/actor/'], a[href*='/pornstar/'], a[href*='/model/'], a[href*='/models/'], a[href*='/actress/'], a[href*='/star/']").each((_: number, el: any) => {
    const name = $(el).attr("title")?.trim() || $(el).text().trim();
    if (!name || name.length < 3) return;
    if (name.split(" ").length > 3 || name.length > 28) return;
    if (FX_PERFORMER_BLOCKLIST.has(name.toLowerCase())) return;
    if (!perfSeen.has(name)) { perfSeen.add(name); performers.push(name); }
  });

  return { embedUrl, durationSeconds, tags, performers };
}

/**
 * Scrape fxpornhd.com for full-length videos — unrestricted (no studio filter).
 *
 * Crawls the main paginated listing (`/page/N/`) recursively from page 1,
 * incrementing until an empty/404 page is encountered or maxPages is reached.
 * This enables a safe, complete historical backfill of up to 150+ pages.
 * Uses onConflictDoUpdate so repeat runs refresh view counts.
 *
 * @param maxPages Hard ceiling on pages to crawl (default 150).
 */
export async function scrapeFXPornHD(maxPages = 150): Promise<void> {
  logger.info({ maxPages }, "scrapeFXPornHD: starting");
  process.stdout.write(
    `\n[FXPORNHD] Starting deep backfill — crawling up to ${maxPages} pages (stops early on empty page)\n`,
  );

  // Load the full DB performer pool once — used for title-based name matching
  // on every video where the detail page has no explicit performer links.
  let fxPerformerPool: string[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT unnest(${videosTable.pornstars}) AS name
      FROM ${videosTable}
      WHERE ${videosTable.status} = 'published' AND ${videosTable.pornstars} IS NOT NULL
    `);
    fxPerformerPool = (rows.rows as Array<Record<string, unknown>>)
      .map((r) => r["name"] as string)
      .filter((n) => {
        if (!n || n.trim().length < 3) return false;
        // Only use multi-word names (≥2 words) for title matching.
        // Single-word names (e.g. "busty", "milf") produce false positives.
        return n.trim().split(/\s+/).length >= 2;
      });
    logger.info({ count: fxPerformerPool.length }, "scrapeFXPornHD: performer pool loaded for title fallback");
  } catch (poolErr) {
    logger.warn({ poolErr }, "scrapeFXPornHD: could not load performer pool — title fallback disabled");
  }

  const seenSlugs = new Set<string>();
  let totalSaved  = 0;
  let page        = 1;

  while (page <= maxPages) {
    const listUrl = page === 1
      ? `${FX_BASE}/`
      : `${FX_BASE}/page/${page}/`;

    const html = await fetchHtmlFrom(listUrl, FX_BASE);
    if (!html) {
      process.stdout.write(`[FXPORNHD] Page ${page} — fetch failed or 404, stopping crawl\n`);
      break;
    }

    const $ = cheerio.load(html);
    const videoLinks: { href: string; title: string; thumb: string; durText: string }[] = [];
    const linkSeen = new Set<string>();

    // Tier 1 — standard tube-site card selectors
    const CARD_SELECTORS = [
      "article.post",
      ".video-item",
      ".thumb-item",
      ".video-block",
      ".grid-item",
      "div[class*='video-card']",
      "div[class*='thumb']",
      ".item",
    ];

    for (const cardSel of CARD_SELECTORS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $(cardSel).each((_: number, el: any) => {
        const card   = $(el);
        const linkEl = card.find("a[href]").first();
        const href   = linkEl.attr("href") ?? "";
        if (!href) return;
        const abs = href.startsWith("http") ? href : `${FX_BASE}${href}`;
        if (!abs.includes("fxpornhd.com")) return;
        if (abs === FX_BASE || abs === `${FX_BASE}/`) return;
        if (abs.includes("/page/") || abs.includes("/category/") || abs.includes("/tag/")) return;
        if (linkSeen.has(abs)) return;

        const imgEl = card.find("img").first();
        let thumb   = imgEl.attr("data-src") ?? imgEl.attr("data-original") ?? imgEl.attr("src") ?? "";
        if (thumb.startsWith("/"))  thumb = `${FX_BASE}${thumb}`;
        if (thumb.startsWith("//")) thumb = `https:${thumb}`;
        if (!thumb.startsWith("http")) return;

        const title =
          card.find(".title, .video-title, h1, h2, h3").first().text().trim() ||
          imgEl.attr("alt")?.trim() ||
          linkEl.attr("title")?.trim() ||
          "";
        if (!title) return;

        const durText = card.find(".duration, .time, [class*='dur'], .runtime").first().text().trim();

        linkSeen.add(abs);
        videoLinks.push({ href: abs, title, thumb, durText });
      });
      if (videoLinks.length > 0) break;
    }

    // Tier 2 — broad fallback: any anchor wrapping an <img> on the same domain
    if (videoLinks.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $("a[href]").each((_: number, el: any) => {
        const a    = $(el);
        const href = a.attr("href") ?? "";
        if (!href) return;
        const abs = href.startsWith("http") ? href : `${FX_BASE}${href}`;
        if (!abs.includes("fxpornhd.com")) return;
        if (abs === FX_BASE || abs === `${FX_BASE}/`) return;
        if (abs.includes("/page/") || abs.includes("/category/") || abs.includes("/tag/")) return;
        if (linkSeen.has(abs)) return;

        const imgEl = a.find("img").first();
        if (!imgEl.length) return;
        let thumb = imgEl.attr("data-src") ?? imgEl.attr("src") ?? "";
        if (thumb.startsWith("/"))  thumb = `${FX_BASE}${thumb}`;
        if (thumb.startsWith("//")) thumb = `https:${thumb}`;
        if (!thumb.startsWith("http")) return;

        const title = imgEl.attr("alt")?.trim() || a.attr("title")?.trim() || "";
        if (!title) return;
        linkSeen.add(abs);
        videoLinks.push({ href: abs, title, thumb, durText: "" });
      });
    }

    if (videoLinks.length === 0) {
      process.stdout.write(`[FXPORNHD] Page ${page} — no video cards found, stopping crawl\n`);
      break;
    }

    // Build candidate objects from listing data
    const candidates: ScrapedVideo[] = [];
    for (const { href, title, thumb, durText } of videoLinks) {
      const durationSeconds = parseDurationText(durText);
      if (durationSeconds > 0 && durationSeconds < MIN_DURATION_SECONDS) continue;

      const pathSlug = href
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\//, "")
        .replace(/\/$/, "");
      const rawSlug = `fx-${slugify(pathSlug || title)}`.slice(0, 120);
      if (seenSlugs.has(rawSlug)) continue;
      seenSlugs.add(rawSlug);

      const familyKeyword = detectFamilyKeyword(title, []);

      candidates.push({
        slug:             rawSlug,
        title,
        description:      null,
        source_url:       href,
        embed_url:        href,   // overwritten by detail-page iframe below
        thumbnail_url:    thumb,
        duration_seconds: durationSeconds,
        duration_text:    durText,
        views:            simulateViews(0),
        likes:            0,
        quality_label:    (() => {
          const lc = title.toLowerCase();
          return (lc.includes("4k") || lc.includes("2160p") ? "4K" : "1080p") as "4K" | "1080p";
        })(),
        category:         familyKeyword ? "family" : inferFxCategoryFromTitle(title, []),
        studio:           null,
        release_year:     simulateReleaseYear(),
        tags:             familyKeyword ? [familyKeyword, "taboo"] : [],
        pornstars:        [],
        status:           "published",
        _familyKeyword:   familyKeyword,
      });
    }

    logger.info({ page, candidates: candidates.length }, "scrapeFXPornHD: listing page parsed");

    // Dedup — skip slugs already in DB
    let newCandidates = candidates;
    try {
      const existingRows = await db
        .select({ slug: videosTable.slug })
        .from(videosTable)
        .where(inArray(videosTable.slug, candidates.map((v) => v.slug)));
      const existingSlugs = new Set(existingRows.map((r: { slug: string }) => r.slug));
      newCandidates = candidates.filter((v) => !existingSlugs.has(v.slug));
    } catch (dbErr) {
      logger.warn({ dbErr }, "scrapeFXPornHD: dedup check failed — proceeding with all candidates");
    }

    let savedThisPage = 0;
    for (const v of newCandidates) {
      const detailHtml = await fetchHtmlFrom(v.source_url, FX_BASE);
      if (!detailHtml) { await delay(FX_DELAY_MS); continue; }

      const {
        embedUrl,
        durationSeconds: detailDur,
        tags:            detailTags,
        performers,
      } = extractFXPornHDMeta(detailHtml, v.title);

      if (!embedUrl) {
        logger.warn({ slug: v.slug }, "scrapeFXPornHD: no iframe embed URL found — skipping");
        await delay(200);
        continue;
      }

      // Merge listing tags with detail-page tags
      const tagSet = new Set<string>(v.tags);
      for (const t of detailTags) tagSet.add(t);

      const mergedTags = Array.from(tagSet);
      const titleLc    = v.title.toLowerCase();
      const has4K      = titleLc.includes("4k") || titleLc.includes("2160p") ||
        mergedTags.some((t) => t.toLowerCase() === "4k" || t.toLowerCase() === "2160p");

      const enriched: ScrapedVideo = {
        ...v,
        embed_url:        embedUrl,
        duration_seconds: detailDur > 0 ? detailDur : v.duration_seconds,
        duration_text:    detailDur > 0
          ? `${Math.floor(detailDur / 60)}m ${detailDur % 60}s`
          : v.duration_text,
        tags:          mergedTags,
        quality_label: has4K ? "4K" : "1080p",
        // Always resolve category from studio prefix / title keywords — never "general"
        category:      inferFxCategoryFromTitle(v.title, mergedTags),
        pornstars:     dedupePerformerNames(performers),
        studio:        v.studio ?? pickSimulatedStudio(v._familyKeyword ?? null),
      };

      // ── Performer enrichment: DB pool scan + dynamic TitleCase discovery ──
      const titleLowerFx = enriched.title.toLowerCase();
      const perfSetFx    = new Set<string>(enriched.pornstars.map((p: string) => p.toLowerCase()));

      // Pass 1 — match known DB performer names against the video title
      if (fxPerformerPool.length > 0) {
        for (const name of fxPerformerPool) {
          if (perfSetFx.has(name.toLowerCase())) continue;
          const nameLower = name.trim().toLowerCase();
          const nameWords = nameLower.split(/\s+/);
          const escaped   = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const inTitle   = nameWords.length === 1
            ? new RegExp(`\\b${escaped}\\b`).test(titleLowerFx)
            : titleLowerFx.includes(nameLower);
          if (inTitle) {
            enriched.pornstars = dedupePerformerNames([...enriched.pornstars, name]);
            perfSetFx.add(name.toLowerCase());
          }
        }
      }

      // onConflictDoUpdate so repeat runs refresh view counts
      await upsertBatchWithViewUpdate([enriched]);
      savedThisPage++;
      await delay(500);
    }

    totalSaved += savedThisPage;
    process.stdout.write(
      `[FXPORNHD] Page ${page} — +${savedThisPage} saved (${totalSaved} total)\n`,
    );
    logger.info({ page, savedThisPage, totalSaved }, "scrapeFXPornHD: page complete");
    await delay(500);
    page++;
  }

  process.stdout.write(`\n[FXPORNHD] ✅ Complete — ${totalSaved} videos saved\n\n`);
  logger.info({ totalSaved }, "scrapeFXPornHD: complete");
}

// ---------------------------------------------------------------------------
// Scraper daemon — two-phase startup seed (no interval; interval lives in index.ts)
// ---------------------------------------------------------------------------

/** Pages for the quick boot seed — populates the DB fast so categories load. */
const INITIAL_SEED_PAGES = 20;

/**
 * Runs the two-phase initial seed on server startup.
 * Phase 1: scrapeDeep(1, 20)  — quick, ~90 s, gets categories populated.
 * Phase 2: scrapeDeep(1, 60)  — full historical backfill, runs after phase 1.
 * The periodic incremental sync is managed separately in index.ts.
 */
export function startScraperDaemon(): void {
  logger.info("Scraper daemon: beginning two-phase startup seed");

  scrapeDeep(1, INITIAL_SEED_PAGES)
    .then(() => seedWhitelistedPerformers())
    .then(() => {
      logger.info("Startup seed phase 1 complete — beginning full deep-crawl (pages 1-60)");
      return scrapeDeep(1, MAIN_PAGES_TO_SCRAPE);
    })
    .then(() => seedWhitelistedPerformers())
    .catch((err) => logger.error({ err }, "Startup scrape seed failed"));
}
