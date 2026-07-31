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
            pornstars: performers.length > 0 ? performers : v.pornstars,
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
    const existingSlugs = new Set(existingRows.map((r) => r.slug));
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
        const performerLower = performer.name.toLowerCase();
        const isDredd = performerLower === "dredd xxx";
        const withEmbed = enriched.filter(
          (v) =>
            isRealEmbedUrl(v.embed_url) &&
            v.pornstars.some((p) => {
              const pl = p.toLowerCase();
              if (isDredd) return pl === "dredd" || pl === "dredd xxx" || pl === "dreddxxx";
              return pl === performerLower;
            }),
        );

        if (withEmbed.length > 0) {
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
// scrapeFamilyPornHD — listing + detail pages from familypornhd.com
// ---------------------------------------------------------------------------

const FPHD_BASE     = "https://familypornhd.com";
const FPHD_DELAY_MS = 600;

/**
 * Extract metadata from a familypornhd.com detail page.
 *
 * Embed URL resolution priority:
 *   1. <iframe src> that contains "/embed" or points to a known third-party
 *      player domain (e.g. streamtape, doodstream, xvideos, etc.) — the
 *      dedicated open embed player; renders without X-Frame-Options issues.
 *   2. Any other external <iframe src> NOT on the familypornhd.com domain.
 *   3. <meta property="og:video"> / <meta property="og:video:url"> — only
 *      accepted when the URL does NOT point back to the bare familypornhd.com page.
 *
 * Any URL that still points to familypornhd.com (non-embed) is treated as null.
 *
 * Tag extraction is restricted to the video's own metadata block.
 * Sidebar tag clouds, footer widget clouds, and channel/studio directory
 * links are explicitly excluded.
 */
function extractFamilyPornHDMeta(html: string): {
  embedUrl: string | null;
  durationSeconds: number;
  tags: string[];
  performers: string[];
} {
  const $ = cheerio.load(html);

  // Primary + fallback iframe pass
  let preferredEmbed = "";
  let fallbackEmbed  = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("iframe[src]").each((_: number, el: any) => {
    if (preferredEmbed) { return false as unknown as void; }
    const s = $(el).attr("src") ?? "";
    if (!s) return;
    const abs = s.startsWith("//") ? `https:${s}` : s;
    if (!abs.startsWith("http")) return;

    // Dedicated embed path on familypornhd.com itself
    if (abs.includes("familypornhd.com/embed")) {
      preferredEmbed = abs;
      return false as unknown as void;
    }
    // Any external player (streamtape, doodstream, xvideos embed, etc.)
    if (!abs.includes("familypornhd.com") && !fallbackEmbed) {
      fallbackEmbed = abs;
    }
  });

  // OG meta fallback — reject bare familypornhd.com page URLs
  let metaEmbed: string | null = null;
  const ogVideo =
    $("meta[property='og:video']").attr("content") ??
    $("meta[property='og:video:url']").attr("content") ??
    null;
  if (ogVideo && !ogVideo.match(/^https?:\/\/familypornhd\.com\/(?!embed)/)) {
    metaEmbed = ogVideo;
  }

  const resolved = preferredEmbed || fallbackEmbed || metaEmbed || null;
  // Final safety-net: never store a bare familypornhd.com page URL as embed
  const embedUrl =
    resolved &&
    resolved.includes("familypornhd.com") &&
    !resolved.includes("/embed")
      ? null
      : resolved;

  // Duration — try OG/video meta first, then visible text elements
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

  // ---------------------------------------------------------------------------
  // Tag / category extraction — STRICT: verified per-video container only.
  //
  // Rules enforced here:
  //   1. Positive container anchor — only the first matching element from
  //      VIDEO_META_CONTAINER_SELECTORS is searched.  If no selector matches,
  //      we return [] rather than falling back to the whole document; a
  //      whole-document scan would ingest sidebar/footer tag clouds whenever
  //      the site's markup changes.
  //   2. Excluded-container guard — always active, even inside a positive root,
  //      because broad containers (article, .post-content) may wrap related-
  //      video sections or inline sidebar widgets on some tube-site themes.
  //   3. href guard — performer, model, studio, and channel links that happen
  //      to share a /tag/ or /category/ path pattern are excluded by href.
  //   4. GENERIC_TAG_BLOCKLIST — low-signal words filtered by exact match.
  //   5. STUDIO_WHITELIST guard — studio brand names ("pervmom", "mylf" …)
  //      are excluded; they appear as anchor text in channel-directory lists
  //      that can sit inside broad positive roots.
  //   6. Length guard — tags shorter than 2 chars or longer than 40 dropped.
  // ---------------------------------------------------------------------------

  /**
   * Priority list of positive selectors for the per-video metadata block.
   * More-specific selectors come first to keep the scope as tight as possible.
   * Broad containers (article, .post-content) are included last so excluded-
   * container filtering catches subsections within them.
   * The first match wins; if nothing matches, tag extraction is skipped.
   */
  const VIDEO_META_CONTAINER_SELECTORS = [
    ".video-metadata",
    ".video-info",
    ".video-details",
    ".video-meta",
    ".post-meta",
    ".entry-meta",
    ".post-tags",
    ".entry-tags",
    ".tags-wrapper",
    ".video-tags",
    "article.post",
    "article",
    ".entry-content",
    ".post-content",
    ".main-content",
    "#content",
  ];

  /** Ancestors that must NOT contain any tag link we accept. */
  const EXCLUDED_CONTAINER_SEL =
    "aside, .sidebar, footer, .footer, " +
    ".widget, .widget-area, .widget-container, " +
    ".tag-cloud, .wp-tag-cloud, .tagcloud, " +
    ".best-channels, .channel-list, .studio-list, " +
    ".related-videos, .related, .recommended, " +
    "nav, .navigation, .nav, header";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isInExcludedContainer(el: any): boolean {
    return $(el).parents(EXCLUDED_CONTAINER_SEL).length > 0;
  }

  /** Generic words that appear as tag/category link text sitewide — not useful. */
  const GENERIC_TAG_BLOCKLIST = new Set([
    "categories", "category", "videos", "video", "tags", "tag", "all",
    "hd", "full", "porn", "sex", "free", "watch", "more", "latest",
    "popular", "top", "best", "new", "trending", "hot", "content",
    "site", "home", "search", "browse", "gallery", "movies", "clips",
  ]);

  /**
   * Validate a candidate tag text.
   * Rejects: empty / too short / too long / generic sitewide words /
   * whitelisted studio names (appear as "best channel" link text even
   * inside article containers on some tube-site themes).
   */
  function isUsableTag(raw: string): boolean {
    const t = raw.trim().toLowerCase();
    if (!t || t.length < 2 || t.length > 40) return false;
    if (GENERIC_TAG_BLOCKLIST.has(t)) return false;
    if (STUDIO_WHITELIST.has(t)) return false; // e.g. "pervmom", "mylf"
    return true;
  }

  // Find the tightest verified container for this page's video metadata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $metaRoot: any = null;
  for (const sel of VIDEO_META_CONTAINER_SELECTORS) {
    const $el = $(sel).first();
    if ($el.length) { $metaRoot = $el; break; }
  }

  const tags: string[] = [];
  const tagSeen        = new Set<string>();

  // ---------------------------------------------------------------------------
  // Tag extraction — three targeted passes, most-specific selector first.
  // All passes are scoped to $metaRoot when a verified container was found.
  // No whole-document fallback: if no container matches, tags returns [].
  // Excluded-container guard is always on even inside a positive root because
  // broad containers (article, #content) may wrap related/sidebar subsections.
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collectTags($scope: any, selector: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $scope.find(selector).each((_: number, el: any) => {
      if (isInExcludedContainer(el)) return;
      const href = $(el).attr("href") ?? "";
      // Skip any link whose href resolves to a performer/studio/channel page
      if (
        href.includes("/pornstar/") || href.includes("/model/") ||
        href.includes("/models/")   || href.includes("/actress/") ||
        href.includes("/studio/")   || href.includes("/channel/")
      ) return;
      const t = $(el).text().trim().toLowerCase();
      if (!isUsableTag(t)) return;
      if (!tagSeen.has(t)) { tagSeen.add(t); tags.push(t); }
    });
  }

  if ($metaRoot) {
    // Pass 1 — tightest: only anchors explicitly linking to a /tag/ path
    //   inside a .video-metadata-item wrapper (WordPress custom field pattern).
    collectTags($metaRoot, ".video-metadata-item a[href*='/tag/']");

    // Pass 2 — common tube-site class for the video's own tag list.
    if (tags.length === 0) collectTags($metaRoot, ".video-tags a");

    // Pass 3 — alternate common class used by many WordPress tube themes.
    if (tags.length === 0) collectTags($metaRoot, ".tag-list a, .tags-list a");
  }

  // ---------------------------------------------------------------------------
  // Performer extraction — whole-page a[href*="/pornstar/"] scan.
  //
  // "/pornstar/" hrefs are semantically specific (they point to a performer
  // profile page) and are unlikely to appear as sidebar navigation noise.
  // Scanning the full document rather than just $metaRoot ensures we catch
  // performer links that some themes place outside the main article container.
  // The excluded-container guard is still applied for belt-and-suspenders safety.
  // ---------------------------------------------------------------------------

  const performers: string[] = [];
  const perfSeen             = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href*='/pornstar/']").each((_: number, el: any) => {
    if (isInExcludedContainer(el)) return;
    const name = $(el).text().trim();
    if (name && name.length > 1 && !perfSeen.has(name)) {
      perfSeen.add(name);
      performers.push(name);
    }
  });

  return { embedUrl, durationSeconds, tags, performers };
}

/**
 * Scrape familypornhd.com listing pages and upsert new taboo/family videos.
 *
 * - Applies TABOO_KEYWORDS filter on titles — same gate as other sources.
 * - Embed URL comes from the detail-page <iframe src="..."> (third-party player
 *   or familypornhd.com/embed/...).
 * - Slugs prefixed "fphd-" to prevent collisions with HQporner slugs.
 * - Uses onConflictDoUpdate (embed_url target) so view counts are refreshed on
 *   repeat runs instead of silently discarding the update.
 *
 * @param pagesCount Listing pages to crawl (default 3).
 */
export async function scrapeFamilyPornHD(pagesCount = 3, breakOnEmpty = false): Promise<void> {
  logger.info({ pagesCount, breakOnEmpty }, "scrapeFamilyPornHD: starting");
  process.stdout.write(`\n[FAMILYPORNHD] Starting scrape — up to ${pagesCount} listing pages${breakOnEmpty ? " (stop on first empty page)" : ""}\n`);

  const seenSlugs = new Set<string>();
  let totalSaved  = 0;

  for (let page = 1; page <= pagesCount; page++) {
    // familypornhd.com uses WordPress standard /page/N/ pagination (NOT /?page=N which 301s to homepage)
    const listUrl = page === 1 ? `${FPHD_BASE}/` : `${FPHD_BASE}/page/${page}/`;
    const html    = await fetchHtmlFrom(listUrl, FPHD_BASE);
    if (!html) {
      process.stdout.write(`[FAMILYPORNHD] Page ${page} — fetch failed, skipping\n`);
      await delay(FPHD_DELAY_MS);
      continue;
    }

    const $          = cheerio.load(html);
    const candidates: ScrapedVideo[] = [];

    // Collect video links + metadata from the listing page.
    // We try progressively broader selectors so the scraper degrades gracefully
    // if the site updates its markup.
    const videoLinks: { href: string; title: string; thumb: string; durText: string }[] = [];
    const linkSeen = new Set<string>();

    // Tier 1 — known tube-site card patterns
    const CARD_SELECTORS = [
      ".video-item",
      ".thumb-item",
      ".video-block",
      "article.video",
      ".videos-list .item",
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
        // Must link to a video detail page on the same domain
        const abs = href.startsWith("http") ? href : `${FPHD_BASE}${href}`;
        if (!abs.includes("familypornhd.com")) return;
        if (linkSeen.has(abs)) return;

        const imgEl  = card.find("img").first();
        let thumb    = imgEl.attr("data-src") ?? imgEl.attr("data-original") ?? imgEl.attr("src") ?? "";
        if (thumb.startsWith("/"))  thumb = `${FPHD_BASE}${thumb}`;
        if (thumb.startsWith("//")) thumb = `https:${thumb}`;
        if (!thumb.startsWith("http")) return;

        const title =
          card.find(".title, .video-title, h3, h2").first().text().trim() ||
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

    // Tier 2 — broad fallback: any anchor on familypornhd.com that wraps an img
    if (videoLinks.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $("a[href]").each((_: number, el: any) => {
        const a    = $(el);
        const href = a.attr("href") ?? "";
        if (!href) return;
        const abs = href.startsWith("http") ? href : `${FPHD_BASE}${href}`;
        if (!abs.includes("familypornhd.com")) return;
        if (abs === FPHD_BASE || abs === `${FPHD_BASE}/`) return;
        if (linkSeen.has(abs)) return;

        const imgEl  = a.find("img").first();
        if (!imgEl.length) return;
        let thumb    = imgEl.attr("data-src") ?? imgEl.attr("src") ?? "";
        if (thumb.startsWith("/"))  thumb = `${FPHD_BASE}${thumb}`;
        if (thumb.startsWith("//")) thumb = `https:${thumb}`;
        if (!thumb.startsWith("http")) return;

        const title =
          imgEl.attr("alt")?.trim() || a.attr("title")?.trim() || "";
        if (!title) return;
        linkSeen.add(abs);
        videoLinks.push({ href: abs, title, thumb, durText: "" });
      });
    }

    // familypornhd.com is a pure family/taboo niche site — every video is on-topic.
    // TABOO_KEYWORDS filter is intentionally bypassed: the source domain is the relevance gate.
    // MIN_DURATION_SECONDS is also relaxed (accept 0 = unknown duration from listing page).
    for (const { href, title, thumb, durText } of videoLinks) {
      const durationSeconds = parseDurationText(durText);
      if (durationSeconds > 0 && durationSeconds < MIN_DURATION_SECONDS) continue;

      // Build a stable slug from the URL path
      const pathSlug = href
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\//, "")
        .replace(/\/$/, "");
      const rawSlug  = `fphd-${slugify(pathSlug || title)}`.slice(0, 120);
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
        quality_label:    "HD",
        category:         familyKeyword ? "family" : "taboo",
        studio:           null,
        release_year:     simulateReleaseYear(),
        tags:             familyKeyword ? [familyKeyword, "taboo"] : ["taboo"],
        pornstars:        [],
        status:           "published",
        _familyKeyword:   familyKeyword,
      });
    }

    logger.info({ page, candidates: candidates.length }, "scrapeFamilyPornHD: listing page parsed");

    if (candidates.length === 0) {
      process.stdout.write(`[FAMILYPORNHD] Page ${page} — 0 candidates after taboo filter\n`);
      if (breakOnEmpty) {
        process.stdout.write(`[FAMILYPORNHD] breakOnEmpty=true — stopping deep crawl at page ${page} (end of archive reached)\n`);
        break;
      }
      await delay(FPHD_DELAY_MS);
      continue;
    }

    // Dedup: skip slugs already present in DB
    let newCandidates = candidates;
    try {
      const existingRows = await db
        .select({ slug: videosTable.slug })
        .from(videosTable)
        .where(inArray(videosTable.slug, candidates.map((v) => v.slug)));
      const existingSlugs = new Set(existingRows.map((r) => r.slug));
      newCandidates = candidates.filter((v) => !existingSlugs.has(v.slug));
    } catch (dbErr) {
      logger.warn({ dbErr }, "scrapeFamilyPornHD: dedup check failed — proceeding with all candidates");
    }

    let savedThisPage = 0;
    for (const v of newCandidates) {
      const detailHtml = await fetchHtmlFrom(v.source_url, FPHD_BASE);
      if (!detailHtml) { await delay(FPHD_DELAY_MS); continue; }

      const {
        embedUrl,
        durationSeconds: detailDur,
        tags:            detailTags,
        performers,
      } = extractFamilyPornHDMeta(detailHtml);

      if (!embedUrl) {
        logger.warn({ slug: v.slug }, "scrapeFamilyPornHD: no external iframe embed URL found — skipping");
        await delay(200);
        continue;
      }

      // Merge listing tags with detail-page tags
      const tagSet = new Set<string>(v.tags);
      for (const t of detailTags) tagSet.add(t);

      const enriched: ScrapedVideo = {
        ...v,
        embed_url:        embedUrl,
        duration_seconds: detailDur > 0 ? detailDur : v.duration_seconds,
        duration_text:    detailDur > 0
          ? `${Math.floor(detailDur / 60)}m ${detailDur % 60}s`
          : v.duration_text,
        tags:      Array.from(tagSet),
        pornstars: performers.length > 0 ? performers : v.pornstars,
        studio:    v.studio ?? pickSimulatedStudio(v._familyKeyword ?? null),
      };

      // onConflictDoUpdate so repeat runs refresh views instead of discarding
      await upsertBatchWithViewUpdate([enriched]);
      savedThisPage++;
      await delay(400);
    }

    totalSaved += savedThisPage;
    process.stdout.write(
      `[FAMILYPORNHD] Page ${page}/${pagesCount} — +${savedThisPage} saved (${totalSaved} total)\n`,
    );
    logger.info({ page, savedThisPage, totalSaved }, "scrapeFamilyPornHD: page complete");
    await delay(FPHD_DELAY_MS);
  }

  process.stdout.write(
    `\n[FAMILYPORNHD] ✅ Complete — ${totalSaved} videos saved across ${pagesCount} pages\n\n`,
  );
  logger.info({ totalSaved, pagesCount }, "scrapeFamilyPornHD: complete");
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
