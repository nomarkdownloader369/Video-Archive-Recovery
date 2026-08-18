import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { Request, Response } from "express";

type CatalogVideo = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  embed_url: string;
  thumbnail_url: string;
  duration_seconds: number;
  duration_text: string | null;
  views: number | null;
  likes: number | null;
  quality_label: string | null;
  category: string | null;
  studio: string | null;
  release_year: number | null;
  tags: string[];
  pornstars: string[];
  status: string | null;
  created_at: string;
  updated_at: string;
};

const BACKUP_PATH = [
  path.resolve(import.meta.dirname, "../backup.json"),
  path.resolve(import.meta.dirname, "../../backup.json"),
].find((candidate) => existsSync(candidate)) ??
  path.resolve(import.meta.dirname, "../../backup.json");
let videos: CatalogVideo[];

const CURATED_CATEGORIES = [
  "milf", "stepmom", "teen", "anal", "pov", "lesbian", "amateur", "blowjob",
  "big tits", "big ass", "creampie", "threesome", "interracial", "bbc", "public",
  "solo", "squirt", "deepthroat", "gangbang", "massage", "casting",
  "family", "taboo", "mature", "old/young", "femdom", "stepdad", "step sister", "freeuse", "drama", "shoplyfter", "brunette", "blonde",
  "redhead", "stockings", "japanese", "ebony", "bbw", "college", "uniform",
  "onlyfans", "erotic", "fetish", "footjob",
] as const;

const CURATED_SET = new Set<string>(CURATED_CATEGORIES);

function normalizeStudio(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function taxonomyEntry(categories: string[], tags: string[]): { categories: string[]; tags: string[] } {
  return { categories, tags };
}

const TABOO_STUDIO_TAXONOMY: Record<string, { categories: string[]; tags: string[] }> = {
  missax: taxonomyEntry(["taboo", "erotic", "drama"], ["missax", "taboo", "erotic", "drama"]),
  puretaboo: taxonomyEntry(["taboo", "erotic", "drama"], ["puretaboo", "taboo", "erotic", "drama"]),
  sweetsinner: taxonomyEntry(["taboo", "erotic", "drama"], ["sweetsinner", "taboo", "erotic", "drama"]),
  sexmex: taxonomyEntry(["family", "taboo", "stepmom"], ["sexmex", "family", "taboo", "stepmom"]),
  mypervyfamily: taxonomyEntry(["family", "taboo", "stepmom", "milf"], ["mypervyfamily", "family", "taboo", "stepmom", "milf"]),
  momcomesfirst: taxonomyEntry(["family", "taboo", "stepmom", "milf"], ["momcomesfirst", "family", "taboo", "stepmom", "milf"]),
  momsteachsex: taxonomyEntry(["family", "taboo", "stepmom", "milf"], ["momsteachsex", "family", "taboo", "stepmom", "milf"]),
  familystrokes: taxonomyEntry(["family", "taboo"], ["familystrokes", "family", "taboo"]),
  familytherapy: taxonomyEntry(["family", "taboo"], ["familytherapy", "family", "taboo"]),
  analtherapy: taxonomyEntry(["anal", "fetish"], ["analtherapy", "anal", "fetish"]),
  sislovesme: taxonomyEntry(["family", "taboo", "step sister"], ["sislovesme", "family", "taboo", "stepsister"]),
  dadcrush: taxonomyEntry(["family", "taboo", "pov"], ["dadcrush", "family", "taboo", "pov"]),
  daughterswap: taxonomyEntry(["family", "taboo"], ["daughterswap", "family", "taboo"]),
  swappz: taxonomyEntry(["family", "taboo"], ["swappz", "family", "taboo"]),
  swappzsingles: taxonomyEntry(["family", "taboo"], ["swappzsingles", "family", "taboo"]),
  freeuse: taxonomyEntry(["freeuse", "pov", "taboo"], ["freeuse", "pov", "taboo"]),
  freeusemylf: taxonomyEntry(["freeuse", "pov", "milf", "taboo"], ["freeuse", "pov", "milf", "taboo"]),
  pervnana: taxonomyEntry(["family", "taboo", "milf"], ["pervnana", "family", "taboo", "milf"]),
  shoplyfter: taxonomyEntry(["shoplyfter", "fetish", "erotic"], ["shoplyfter", "fetish", "erotic"]),
  shoplyftermylf: taxonomyEntry(["shoplyfter", "fetish", "milf"], ["shoplyfter", "fetish", "milf"]),
  dickdrainers: taxonomyEntry(["anal", "fetish"], ["dickdrainers", "anal", "fetish"]),
  throated: taxonomyEntry(["anal", "fetish"], ["throated", "anal", "fetish"]),
  brattymilf: taxonomyEntry(["milf", "family", "taboo"], ["brattymilf", "milf", "family", "taboo"]),
  momswap: taxonomyEntry(["family", "taboo", "milf"], ["momswap", "family", "taboo", "milf"]),
  auntswap: taxonomyEntry(["family", "taboo", "milf"], ["auntswap", "family", "taboo", "milf"]),
  householdfantasy: taxonomyEntry(["family", "taboo", "drama"], ["householdfantasy", "family", "taboo", "drama"]),
  stepfampov: taxonomyEntry(["family", "taboo", "pov"], ["stepfampov", "family", "taboo", "pov"]),
  stepsiblings: taxonomyEntry(["family", "taboo", "step sister"], ["stepsiblings", "family", "taboo", "stepsister"]),
  brattysis: taxonomyEntry(["family", "taboo", "step sister"], ["brattysis", "family", "taboo", "stepsister"]),
  momlover: taxonomyEntry(["milf", "stepmom", "taboo"], ["momlover", "milf", "stepmom", "taboo"]),
  mydirtyuncle: taxonomyEntry(["family", "taboo"], ["mydirtyuncle", "family", "taboo"]),
  myfriendshotmom: taxonomyEntry(["milf", "stepmom", "taboo"], ["myfriendshotmom", "milf", "stepmom", "taboo"]),
  mysistershotfriend: taxonomyEntry(["family", "taboo", "step sister"], ["mysistershotfriend", "family", "taboo", "stepsister"]),
  myfirstsexteacher: taxonomyEntry(["erotic", "drama"], ["myfirstsexteacher", "erotic", "drama"]),
  naughtyoffice: taxonomyEntry(["erotic", "drama"], ["naughtyoffice", "erotic", "drama"]),
  housewife1on1: taxonomyEntry(["erotic", "milf"], ["housewife1on1", "erotic", "milf"]),
  seducedbyacougar: taxonomyEntry(["erotic", "milf", "drama"], ["seducedbyacougar", "erotic", "milf", "drama"]),
  baddaddypov: taxonomyEntry(["family", "taboo", "pov"], ["baddaddypov", "family", "taboo", "pov"]),
  stepsiblingscaught: taxonomyEntry(["family", "taboo", "step sister"], ["stepsiblingscaught", "family", "taboo", "stepsister"]),
  stepmomlessons: taxonomyEntry(["family", "taboo", "stepmom", "milf"], ["stepmomlessons", "family", "taboo", "stepmom", "milf"]),
  stepdaughterfantasy: taxonomyEntry(["family", "taboo"], ["stepdaughterfantasy", "family", "taboo"]),
  themomnextdoor: taxonomyEntry(["family", "taboo", "stepmom", "milf"], ["themomnextdoor", "family", "taboo", "stepmom", "milf"]),
  stepbrotherfantasy: taxonomyEntry(["family", "taboo"], ["stepbrotherfantasy", "family", "taboo"]),
  myfamilypies: taxonomyEntry(["family", "taboo"], ["myfamilypies", "family", "taboo"]),
  momshoot: taxonomyEntry(["family", "taboo", "milf"], ["momshoot", "family", "taboo", "milf"]),
  taboopov: taxonomyEntry(["taboo", "pov"], ["taboopov", "taboo", "pov"]),
  sinfulfamily: taxonomyEntry(["family", "taboo"], ["sinfulfamily", "family", "taboo"]),
  familyscrew: taxonomyEntry(["family", "taboo"], ["familyscrew", "family", "taboo"]),
  sistertrick: taxonomyEntry(["family", "taboo", "step sister"], ["sistertrick", "family", "taboo", "stepsister"]),
  stepbropov: taxonomyEntry(["family", "taboo", "pov"], ["stepbropov", "family", "taboo", "pov"]),
  stepsispov: taxonomyEntry(["family", "taboo", "step sister", "pov"], ["stepsispov", "family", "taboo", "stepsister", "pov"]),
  stepaunt: taxonomyEntry(["family", "taboo"], ["stepaunt", "family", "taboo"]),
  stepcousin: taxonomyEntry(["family", "taboo"], ["stepcousin", "family", "taboo"]),
  inthefamily: taxonomyEntry(["family", "taboo"], ["inthefamily", "family", "taboo"]),
  forbiddenfamily: taxonomyEntry(["family", "taboo"], ["forbiddenfamily", "family", "taboo"]),
  darktaboo: taxonomyEntry(["taboo", "drama"], ["darktaboo", "taboo", "drama"]),
  tabooheat: taxonomyEntry(["taboo", "erotic"], ["tabooheat", "taboo", "erotic"]),
  fostertapes: taxonomyEntry(["family", "taboo", "drama"], ["fostertapes", "family", "taboo", "drama"]),
  brattamer: taxonomyEntry(["fetish", "taboo"], ["brattamer", "fetish", "taboo"]),
  youngbusty: taxonomyEntry(["erotic"], ["youngbusty", "erotic"]),
  legalporno: taxonomyEntry(["erotic", "drama"], ["legalporno", "erotic", "drama"]),
  analvids: taxonomyEntry(["anal"], ["analvids", "anal"]),
};

function applyBackupTaxonomy(video: CatalogVideo): CatalogVideo {
  const studioKey = video.studio ? normalizeStudio(video.studio) : "";
  const titleKey = normalizeStudio(video.title);
  const taxonomy = TABOO_STUDIO_TAXONOMY[studioKey] ??
    Object.entries(TABOO_STUDIO_TAXONOMY).find(([key]) => titleKey.includes(key))?.[1];
  const tags = [...new Set((video.tags ?? []).map((tag) => tag.toLowerCase()))];
  if (!taxonomy) return { ...video, tags };
  return {
    ...video,
    category: taxonomy.categories[0],
    tags: [...new Set([...taxonomy.tags, ...tags])],
  };
}

videos = loadBackup().map(applyBackupTaxonomy);

const CATEGORY_ALIASES: Record<string, string[]> = {
  stepmom: ["stepmom", "step-mom", "step mom", "mom", "mommy"],
  stepdad: ["stepdad", "step-dad", "step dad", "dad"],
  "old/young": ["old/young", "old-young", "old young", "old and young", "old & young", "granny", "mature/teen"],
  lesbian: ["lesbian", "lesbians"],
  solo: ["solo", "masturbation"],
  femdom: ["femdom", "bondage", "bdsm", "domination"],
  squirt: ["squirt", "squirting"],
  gangbang: ["gangbang", "gang bang"],
  deepthroat: ["deepthroat", "deep throat"],
  creampie: ["creampie", "cream pie"],
  "big tits": ["big tits", "big boobs", "big breasts"],
  bbc: ["bbc", "big black cock", "interracial bbc", "black cock", "interracial"],
  "big ass": ["big ass", "big butt", "booty", "butt", "ass"],
  japanese: ["japanese", "japan", "asian", "jav", "asian babe"],
  ebony: ["ebony", "black", "african"],
  bbw: ["bbw", "big beautiful woman", "curvy", "chubby", "plus size"],
  college: ["college", "sorority", "dorm", "university", "school girl", "schoolgirl"],
  uniform: ["uniform", "school uniform", "nurse", "maid"],
  onlyfans: ["onlyfans", "only fans", "of model", "content creator"],
  erotic: ["erotic", "erotica", "sensual", "romantic"],
  fetish: ["fetish", "kink", "kinky", "latex", "leather"],
  footjob: ["footjob", "foot job", "feet", "foot worship", "foot fetish"],
  "step sister": ["step sister", "stepsister", "step-sister"],
  freeuse: ["freeuse", "free use"],
  shoplyfter: ["shoplyfter", "shoplifter"],
};
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
  for (const alias of aliases) {
    if (!CURATED_SET.has(alias)) ALIAS_TO_CANONICAL.set(alias, canonical);
  }
}

const CATEGORY_FALLBACK_PHOTO = null;

function loadBackup(): CatalogVideo[] {
  const parsed = JSON.parse(readFileSync(BACKUP_PATH, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("backup.json root must be an array");
  return parsed as CatalogVideo[];
}

function normalize(value: string | undefined): string | undefined {
  return value?.toLowerCase().trim();
}

function matchesCategory(video: CatalogVideo, category: string): boolean {
  const aliases = CATEGORY_ALIASES[category] ?? [category];
  const values = [video.category ?? "", ...video.tags].map((value) => value.toLowerCase());
  return aliases.some((alias) => values.includes(alias));
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function filteredVideos(req: Request): CatalogVideo[] {
  const { q, category, studio, pornstar, tag, hero } = req.query as Record<string, string | undefined>;
  const qNorm = q?.trim().toLowerCase();
  const categoryNorm = normalize(category);
  const studioNorm = normalize(studio);
  const pornstarNorm = normalize(pornstar);
  const tagNorm = normalize(tag)?.replace(/^#/, "");

  return videos.filter((video) => {
    if (video.status !== "published") return false;
    if (qNorm && !`${video.title} ${video.description ?? ""}`.toLowerCase().includes(qNorm)) return false;
    if (categoryNorm && !matchesCategory(video, categoryNorm)) return false;
    if (studioNorm && (video.studio ?? "").toLowerCase() !== studioNorm) return false;
    if (pornstarNorm && !video.pornstars.some((name) => name.toLowerCase() === decode(pornstarNorm))) return false;
    if (tagNorm && !video.tags.some((value) => value.toLowerCase() === tagNorm)) return false;
    if (hero === "taboo-family") {
      const familyTags = new Set(["family", "taboo", "stepmom", "stepsister", "milf"]);
      const category = (video.category ?? "").toLowerCase();
      if (!familyTags.has(category) && !video.tags.some((value) => familyTags.has(value.toLowerCase()))) return false;
    }
    return true;
  });
}

function sortVideos(items: CatalogVideo[], sort: string): CatalogVideo[] {
  if (sort === "random") {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  const valueFor = (video: CatalogVideo): number => {
    if (sort === "views") return video.views ?? 0;
    if (sort === "likes") return video.likes ?? 0;
    if (sort === "duration") return video.duration_seconds ?? 0;
    return Date.parse(video.created_at) || 0;
  };
  const direction = sort === "oldest" ? 1 : -1;
  return items.sort((a, b) => (valueFor(a) - valueFor(b)) * direction);
}

function baseUrl(req: Request): string {
  const protocol = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  const host = req.headers.host ?? "localhost";
  return `${protocol}://${host}`;
}

const router = Router();

router.get("/videos", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "24"), 10) || 24));
  const filtered = sortVideos(filteredVideos(req), String(req.query["sort"] ?? "recent"));
  const total = filtered.length;
  const start = (page - 1) * limit;

  res.json({
    data: filtered.slice(start, start + limit),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

router.get("/thumb", async (req: Request, res: Response) => {
  const url = String(req.query["url"] ?? "");
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const sourceUrl = new URL(url);
    const upstream = await fetch(url, {
      headers: {
        Referer: `${sourceUrl.protocol}//${sourceUrl.host}/`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

router.get("/videos/:slug", (req: Request, res: Response) => {
  const video = videos.find(
    (candidate) => candidate.status === "published" && candidate.slug === String(req.params["slug"]),
  );
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  video.views = (video.views ?? 0) + 1;
  res.json({ data: video });
});

router.get("/browse/studios", (_req: Request, res: Response) => {
  const studioMap = new Map<string, { studio: string; video_count: number; top_thumbnail: string | null; total_views: number }>();
  for (const video of videos) {
    if (video.status !== "published" || !video.studio) continue;
    const existing = studioMap.get(video.studio);
    if (existing) {
      existing.video_count += 1;
      existing.total_views += video.views ?? 0;
      if ((video.views ?? 0) > 0 && !existing.top_thumbnail) existing.top_thumbnail = video.thumbnail_url;
    } else {
      studioMap.set(video.studio, {
        studio: video.studio,
        video_count: 1,
        top_thumbnail: video.thumbnail_url,
        total_views: video.views ?? 0,
      });
    }
  }
  res.json({ data: [...studioMap.values()].sort((a, b) => b.video_count - a.video_count) });
});

router.get("/browse/pornstars", (req: Request, res: Response) => {
  const performerMap = new Map<string, { video_count: number; total_views: number; topThumbnail: string | null; topViews: number }>();
  for (const video of videos) {
    if (video.status !== "published") continue;
    for (const rawName of video.pornstars) {
      const name = rawName.trim();
      if (!name) continue;
      const existing = performerMap.get(name);
      if (existing) {
        existing.video_count += 1;
        existing.total_views += video.views ?? 0;
        if ((video.views ?? 0) > existing.topViews) {
          existing.topViews = video.views ?? 0;
          existing.topThumbnail = video.thumbnail_url;
        }
      } else {
        performerMap.set(name, {
          video_count: 1,
          total_views: video.views ?? 0,
          topThumbnail: video.thumbnail_url,
          topViews: video.views ?? 0,
        });
      }
    }
  }

  const base = baseUrl(req);
  const toSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const data = [...performerMap.entries()]
    .map(([name, entry]) => ({
      name,
      slug: toSlug(name),
      video_count: entry.video_count,
      total_views: entry.total_views,
      photo: entry.topThumbnail
        ? `${base}/api/pf/thumb?url=${encodeURIComponent(entry.topThumbnail)}`
        : null,
    }))
    .sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name))
    .slice(0, 349);

  res.json({ data });
});

router.get("/browse/categories", (req: Request, res: Response) => {
  const aggregate = new Map<string, { video_count: number; thumbnails: { url: string; views: number }[] }>();
  for (const video of videos) {
    if (video.status !== "published") continue;
    const labels = [video.category ?? "", ...video.tags]
      .map((value) => value.toLowerCase())
      .map((value) => ALIAS_TO_CANONICAL.get(value) ?? (CURATED_SET.has(value) ? value : null))
      .filter((value): value is string => value !== null);

    for (const label of new Set(labels)) {
      const existing = aggregate.get(label) ?? { video_count: 0, thumbnails: [] };
      existing.video_count += 1;
      existing.thumbnails.push({ url: video.thumbnail_url, views: video.views ?? 0 });
      aggregate.set(label, existing);
    }
  }

  const usedThumbnails = new Set<string>();
  const base = baseUrl(req);
  const data = [...CURATED_CATEGORIES]
    .sort((a, b) => (aggregate.get(b)?.video_count ?? 0) - (aggregate.get(a)?.video_count ?? 0))
    .map((name) => {
      const row = aggregate.get(name);
      const thumbnail = row?.thumbnails
        .slice()
        .sort((a, b) => b.views - a.views)
        .map((candidate) => candidate.url)
        .find((candidate) => !usedThumbnails.has(candidate));
      if (thumbnail) usedThumbnails.add(thumbnail);
      return {
        name,
        video_count: row?.video_count ?? 0,
        photo: thumbnail
          ? `${base}/api/pf/thumb?url=${encodeURIComponent(thumbnail)}`
          : CATEGORY_FALLBACK_PHOTO,
      };
    });

  res.json({ data });
});

export default router;
