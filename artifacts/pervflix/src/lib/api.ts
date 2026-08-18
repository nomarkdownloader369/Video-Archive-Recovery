import { STUDIOS, PORNSTARS, CATEGORIES, type Video, type Pornstar } from "./videos";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/pf";

export type ListParams = {
  page?: number;
  limit?: number;
  sort?: "new" | "top" | "views" | "duration" | "random";
  category?: string;
  studio?: string;
  pornstar?: string;
  tag?: string;
  q?: string;
};

export type PagedVideos = {
  videos: Video[];
  pagination: { total: number; pages: number; page: number; limit: number };
};

type DbVideo = {
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
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function mapDbVideo(v: DbVideo): Video {
  const secs = v.duration_seconds ?? 0;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const duration = v.duration_text ?? `${mins}:${String(remSecs).padStart(2, "0")}`;
  const rawQuality = (v.quality_label ?? "1080p").toUpperCase();
  const quality: "4K" | "1080p" | "HD" =
    rawQuality === "4K" || rawQuality === "2160P" ? "4K"
    : rawQuality === "1080P" ? "1080p"
    : "HD";
  return {
    id: v.id,
    slug: v.slug,
    title: v.title,
    studio: v.studio ?? "",
    category: v.category ?? "",
    stars: v.pornstars ?? [],
    year: v.release_year ?? new Date(v.created_at).getFullYear(),
    duration,
    duration_seconds: secs,
    views: formatViews(v.views ?? 0),
    quality,
    description: v.description ?? "",
    thumbSeed: v.thumbnail_url,
    tags: v.tags ?? [],
    embed_url: v.embed_url,
  };
}

function qs(params: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  endpoint: (path: string, params: ListParams = {}) =>
    `${API_BASE}${path}${qs(params as Record<string, unknown>)}`,

  listVideos: async (params: ListParams = {}): Promise<PagedVideos> => {
    const sortMap: Record<string, string> = {
      new: "recent",
      top: "likes",
      views: "views",
      duration: "duration",
      random: "random",
    };
    const apiSort = sortMap[params.sort ?? "new"] ?? "recent";
    const qParams: Record<string, unknown> = {
      page: params.page ?? 1,
      limit: params.limit ?? 24,
      sort: apiSort,
    };
    if (params.studio) qParams.studio = params.studio;
    if (params.category) qParams.category = params.category;
    if (params.pornstar) qParams.pornstar = params.pornstar;
    if (params.tag) qParams.tag = params.tag;
    if (params.q) qParams.q = params.q;
    const res = await fetch(`${API_BASE}/videos${qs(qParams)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      data: DbVideo[];
      pagination: { total: number; pages: number; page: number; limit: number };
    };
    return {
      videos: (json.data ?? []).map(mapDbVideo),
      pagination: json.pagination ?? { total: 0, pages: 1, page: 1, limit: 24 },
    };
  },

  listHero: async (): Promise<Video[]> => {
    const res = await fetch(`${API_BASE}/videos?hero=taboo-family&sort=views&limit=5&page=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: DbVideo[] };
    return (json.data ?? []).map(mapDbVideo);
  },

  getVideo: async (slug: string): Promise<Video | undefined> => {
    const res = await fetch(`${API_BASE}/videos/${encodeURIComponent(slug)}`);
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data: DbVideo };
    return json.data ? mapDbVideo(json.data) : undefined;
  },

  listStudios: async (): Promise<string[]> => {
    try {
      const res = await fetch(`${API_BASE}/browse/studios`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: { studio: string }[] };
      if (json.data && json.data.length > 0)
        return json.data.map((s) => s.studio).filter(Boolean);
    } catch (_) {
      /* fall through */
    }
    return STUDIOS;
  },

  listPornstars: async (): Promise<Pornstar[]> => {
    try {
      const res = await fetch(`${API_BASE}/browse/pornstars`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data: {
          name: string;
          slug: string;
          video_count: number;
          total_views: number;
          photo: string;
        }[];
      };
      if (json.data && json.data.length > 0)
        return json.data.map((p, i) => ({
          name:         p.name,
          slug:         p.slug,
          avatarSeed:   `ps-${i}`,
          videoCount:   p.video_count,
          totalViews:   p.total_views,
          topThumbnail: null,
          photo:        p.photo,
        }));
    } catch (_) {
      /* fall through */
    }
    return PORNSTARS;
  },

  listCategories: async (): Promise<string[]> => {
    try {
      const res = await fetch(`${API_BASE}/browse/categories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: { category: string }[] };
      if (json.data && json.data.length > 0)
        return json.data.map((c) => c.category).filter(Boolean);
    } catch (_) {
      /* fall through */
    }
    return CATEGORIES;
  },

  search: async (q: string, params: ListParams = {}): Promise<PagedVideos> =>
    api.listVideos({ ...params, q }),
};
