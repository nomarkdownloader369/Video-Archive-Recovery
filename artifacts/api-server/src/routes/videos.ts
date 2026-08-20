import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import {
  eq,
  ilike,
  or,
  and,
  desc,
  asc,
  sql,
} from "drizzle-orm";

const router = Router();

// ---------------------------------------------------------------------------
// 39 curated taxonomy categories
// ---------------------------------------------------------------------------
const CURATED_CATEGORIES = [
  "milf", "stepmom", "teen", "anal", "pov", "lesbian", "amateur", "blowjob",
  "big tits", "big ass", "creampie", "threesome", "interracial", "bbc", "public",
  "solo", "squirt", "deepthroat", "gangbang", "massage", "casting",
  "family", "mature", "old/young", "femdom", "stepdad", "brunette", "blonde",
  "redhead", "stockings", "japanese", "ebony", "bbw", "college", "uniform",
  "onlyfans", "erotic", "fetish", "footjob",
] as const;

const CURATED_SET = new Set<string>(CURATED_CATEGORIES);

// ---------------------------------------------------------------------------
// Category synonym / alias engine
// ---------------------------------------------------------------------------
const CATEGORY_ALIASES: Record<string, string[]> = {
  stepmom:      ["stepmom", "step-mom", "step mom", "mom", "mommy"],
  stepdad:      ["stepdad", "step-dad", "step dad", "dad"],
  "old/young":  ["old/young", "old-young", "old young", "old and young", "old & young", "granny", "mature/teen"],
  lesbian:      ["lesbian", "lesbians"],
  solo:         ["solo", "masturbation"],
  femdom:       ["femdom", "bondage", "bdsm", "domination"],
  squirt:       ["squirt", "squirting"],
  gangbang:     ["gangbang", "gang bang"],
  deepthroat:   ["deepthroat", "deep throat"],
  creampie:     ["creampie", "cream pie"],
  "big tits":   ["big tits", "big boobs", "big breasts"],
  bbc:          ["bbc", "big black cock", "interracial bbc", "black cock", "interracial"],
  "big ass":    ["big ass", "big butt", "booty", "butt", "ass"],
  japanese:     ["japanese", "japan", "asian", "jav", "asian babe"],
  ebony:        ["ebony", "black", "african"],
  bbw:          ["bbw", "big beautiful woman", "curvy", "chubby", "plus size"],
  college:      ["college", "sorority", "dorm", "university", "school girl", "schoolgirl"],
  uniform:      ["uniform", "school uniform", "nurse", "maid"],
  onlyfans:     ["onlyfans", "only fans", "of model", "content creator"],
  erotic:       ["erotic", "erotica", "sensual", "romantic"],
  fetish:       ["fetish", "kink", "kinky", "latex", "leather"],
  footjob:      ["footjob", "foot job", "feet", "foot worship", "foot fetish"],
};

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, variants] of Object.entries(CATEGORY_ALIASES)) {
  for (const v of variants) {
    if (!CURATED_SET.has(v)) {
      ALIAS_TO_CANONICAL.set(v, canonical);
    }
  }
}

router.get("/videos", async (req: Request, res: Response) => {
  const {
    page = "1",
    limit = "24",
    sort = "recent",
    q,
    category,
    studio,
    pornstar,
    tag,
  } = req.query as Record<string, string | undefined>;

  const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "24", 10) || 24));
  const offset = (pageNum - 1) * limitNum;

  const categoryNorm   = category?.toLowerCase().trim();
  const studioNorm     = studio?.toLowerCase().trim();
  const pornstarNorm   = pornstar?.toLowerCase().trim();
  const tagNorm        = tag?.toLowerCase().trim().replace(/^#/, "");
  const qNorm          = q?.trim();

  const conditions = [eq(videosTable.status, "published")];

  if (qNorm) {
    conditions.push(
      or(
        ilike(videosTable.title, `%${qNorm}%`),
        ilike(videosTable.description ?? videosTable.description, `%${qNorm}%`),
      )!,
    );
  }

  if (categoryNorm) {
    const aliases = CATEGORY_ALIASES[categoryNorm] ?? [categoryNorm];
    conditions.push(
      or(
        sql`lower(${videosTable.category}) IN (${sql.join(aliases.map((a) => sql`${a}`), sql`, `)})`,
        sql`EXISTS (
          SELECT 1 FROM unnest(${videosTable.tags}) AS t
          WHERE lower(t) IN (${sql.join(aliases.map((a) => sql`${a}`), sql`, `)})
        )`,
      )!,
    );
  }
  if (studioNorm)   conditions.push(sql`lower(${videosTable.studio}) = ${studioNorm}`);

  if (pornstarNorm) {
    const decodedPornstar = (() => {
      try { return decodeURIComponent(pornstarNorm); } catch { return pornstarNorm; }
    })();
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM unnest(${videosTable.pornstars}) AS p
        WHERE lower(p) = lower(${decodedPornstar})
      )`,
    );
  }

  if (tagNorm) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM unnest(${videosTable.tags}) AS t
        WHERE lower(t) = ${tagNorm}
      )`,
    );
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0];

  const orderBy =
    sort === "random"
      ? sql`random()`
      : sort === "views"
        ? desc(videosTable.views)
        : sort === "likes"
          ? desc(videosTable.likes)
          : sort === "duration"
            ? desc(videosTable.duration_seconds)
            : sort === "oldest"
              ? asc(videosTable.created_at)
              : desc(videosTable.created_at);

  const [videos, countResult] = await Promise.all([
    db
      .select()
      .from(videosTable)
      .where(where)
      .orderBy(orderBy)
      .limit(limitNum)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(videosTable)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  res.json({
    data: videos,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

router.get("/videos/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params["slug"]);

  const video = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.slug, slug), eq(videosTable.status, "published")))
    .limit(1);

  if (!video[0]) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  await db
    .update(videosTable)
    .set({ views: sql`${videosTable.views} + 1` })
    .where(eq(videosTable.id, video[0].id));

  res.json({ data: { ...video[0], views: (video[0].views ?? 0) + 1 } });
});

// ─── Thumbnail proxy — bypasses hotlink protection ──────────────────────────
router.get("/thumb", async (req: Request, res: Response) => {
  const url = String(req.query["url"] ?? "");
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  try {
    // Use the image's own origin as the Referer so hotlink protection
    // on every source (hqporner, fxpornhd, galaxyporn, etc.) is satisfied.
    const sourceReferer = (() => {
      try { const u = new URL(url); return `${u.protocol}//${u.host}/`; }
      catch { return "https://hqporner.com/"; }
    })();
    const upstream = await fetch(url, {
      headers: {
        "Referer": sourceReferer,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const ct = upstream.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (_) {
    res.status(502).end();
  }
});

router.get("/browse/studios", async (_req: Request, res: Response) => {
  const studios = await db
    .select({
      studio: videosTable.studio,
      video_count: sql<number>`cast(count(*) as int)`,
      top_thumbnail: sql<string>`(
        array_agg(${videosTable.thumbnail_url} order by ${videosTable.views} desc)
      )[1]`,
      total_views: sql<number>`cast(sum(${videosTable.views}) as int)`,
    })
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "published"),
        sql`${videosTable.studio} is not null`,
      ),
    )
    .groupBy(videosTable.studio)
    .orderBy(desc(sql`count(*)`));

  res.json({ data: studios });
});

// ---------------------------------------------------------------------------
// Curated performer whitelist — 33 performers
// ---------------------------------------------------------------------------
const PERFORMER_WHITELIST_ROUTES: { name: string; slug: string }[] = [
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

const PERFORMER_FALLBACK_PHOTO =
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80";

router.get("/browse/pornstars", async (req: Request, res: Response) => {
  // Fetch only the fields we need — avoids pulling full video rows
  const videos = await db
    .select({
      pornstars:     videosTable.pornstars,
      thumbnail_url: videosTable.thumbnail_url,
      views:         videosTable.views,
    })
    .from(videosTable)
    .where(eq(videosTable.status, "published"));

  // In-memory aggregation — immune to SQL unnest / GROUP BY dialect issues
  type PerformerEntry = {
    video_count: number;
    total_views: number;
    // Each video this performer appears in, kept for top-thumbnail resolution
    videoRefs: { thumbnail_url: string | null; views: number | null }[];
  };

  const performerMap = new Map<string, PerformerEntry>();

  for (const video of videos) {
    const stars = video.pornstars ?? [];
    for (const raw of stars) {
      if (!raw) continue;
      const name = raw.trim();
      if (!name) continue;

      const existing = performerMap.get(name);
      if (existing) {
        existing.video_count += 1;
        existing.total_views += video.views ?? 0;
        existing.videoRefs.push({ thumbnail_url: video.thumbnail_url, views: video.views });
      } else {
        performerMap.set(name, {
          video_count: 1,
          total_views: video.views ?? 0,
          videoRefs: [{ thumbnail_url: video.thumbnail_url, views: video.views }],
        });
      }
    }
  }

  const BASE = req.protocol + "://" + req.get("host");

  // Build slug from performer name (e.g. "Lana Rhoades" → "lana-rhoades")
  const toSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const data = Array.from(performerMap.entries())
    .map(([name, entry]) => {
      // Pick the thumbnail from the highest-viewed video for this performer
      const topThumb = entry.videoRefs
        .slice()
        .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
        .find((v) => v.thumbnail_url)?.thumbnail_url ?? null;

      const photo = topThumb
        ? `${BASE}/api/pf/thumb?url=${encodeURIComponent(topThumb)}`
        : PERFORMER_FALLBACK_PHOTO;

      return {
        name,
        slug:        toSlug(name),
        video_count: entry.video_count,
        total_views: entry.total_views,
        photo,
      };
    })
    // Sort by most videos first, then alphabetically for ties
    .sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name))
    .slice(0, 349);

  res.json({ data });
});

// Generic dark fallback served directly (no proxy) for zero-count categories.
const CATEGORY_FALLBACK_PHOTO =
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80";

router.get("/browse/categories", async (req: Request, res: Response) => {
  const rows = await db.execute<{
    label: string;
    video_count: string;
    thumbnail_candidates: string[];
  }>(sql`
    SELECT
      src.label,
      cast(count(*) as int)                                                AS video_count,
      (array_agg(src.thumb ORDER BY src.views DESC NULLS LAST))[1:20]     AS thumbnail_candidates
    FROM (
      SELECT
        lower(${videosTable.category})  AS label,
        ${videosTable.thumbnail_url}    AS thumb,
        ${videosTable.views}            AS views
      FROM ${videosTable}
      WHERE ${videosTable.status} = 'published'
        AND ${videosTable.category} IS NOT NULL

      UNION ALL

      SELECT
        lower(t.tag)                    AS label,
        ${videosTable.thumbnail_url}    AS thumb,
        ${videosTable.views}            AS views
      FROM ${videosTable}
      CROSS JOIN LATERAL unnest(${videosTable.tags}) AS t(tag)
      WHERE ${videosTable.status} = 'published'
    ) AS src
    GROUP BY src.label
  `);

  type AggRow = {
    video_count: number;
    candidates: string[];
    top_views: number;
  };
  const agg = new Map<string, AggRow>();

  for (const r of rows.rows) {
    const canonical =
      ALIAS_TO_CANONICAL.get(r.label) ??
      (CURATED_SET.has(r.label) ? r.label : null);
    if (!canonical) continue;

    const count = parseInt(String(r.video_count), 10) || 0;
    const incoming = Array.isArray(r.thumbnail_candidates) ? r.thumbnail_candidates : [];
    const existing = agg.get(canonical);

    if (!existing) {
      agg.set(canonical, { video_count: count, candidates: incoming, top_views: count });
    } else {
      const merged = count > existing.top_views
        ? [...incoming, ...existing.candidates]
        : [...existing.candidates, ...incoming];
      agg.set(canonical, {
        video_count: existing.video_count + count,
        candidates:  merged,
        top_views:   Math.max(existing.top_views, count),
      });
    }
  }

  const BASE = req.protocol + "://" + req.get("host");

  const sorted = CURATED_CATEGORIES
    .map((name) => ({ name, row: agg.get(name) }))
    .sort((a, b) => (b.row?.video_count ?? 0) - (a.row?.video_count ?? 0));

  const usedThumbs = new Set<string>();

  const data = sorted.map(({ name, row }) => {
    const count = row?.video_count ?? 0;
    let thumb: string | null = null;

    if (count > 0 && row) {
      for (const candidate of row.candidates) {
        if (candidate && !usedThumbs.has(candidate)) {
          thumb = candidate;
          usedThumbs.add(candidate);
          break;
        }
      }
    }

    return {
      name,
      video_count: count,
      photo: count > 0 && thumb
        ? `${BASE}/api/pf/thumb?url=${encodeURIComponent(thumb)}`
        : CATEGORY_FALLBACK_PHOTO,
    };
  });

  res.json({ data });
});

export default router;
