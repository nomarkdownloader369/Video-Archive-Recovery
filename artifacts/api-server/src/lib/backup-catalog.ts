import fs from "node:fs";
import path from "node:path";

export type BackupVideo = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  embed_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number;
  duration_text: string;
  views: number;
  likes: number;
  quality_label: string;
  category: string;
  studio: string;
  release_year: number;
  tags: string[];
  pornstars: string[];
  status: string;
  created_at: string;
  updated_at: string;
  mirrors?: { name: string; url: string }[];
  primaryEmbedUrl?: string | null;
  embedUrl?: string | null;
};

const BACKUP_PATHS = [
  path.resolve(process.cwd(), "artifacts/api-server/backup.json"),
  path.resolve(process.cwd(), "backup.json"),
];
let cached: BackupVideo[] | null = null;

function repairEmbedUrl(video: BackupVideo): string | null {
  const raw = video.primaryEmbedUrl ?? video.embed_url ?? video.embedUrl ?? null;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/fxpornhd/i.test(`${url.hostname}${url.pathname}`)) return raw;
    if (url.hostname.toLowerCase() === "player.fxpornhd.com" && url.pathname.startsWith("/embed/")) return url.toString();
    const id = url.pathname.match(/(?:embed|video|player|watch)\/?([^/]+)/i)?.[1] ?? url.pathname.split("/").filter(Boolean).pop();
    if (!id) return null;
    return `https://player.fxpornhd.com/embed/${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

const PERFORMER_BLOCKLIST = /\b(?:step(?:mom|dad|sister|brother)?|mom(?:my)?|dad(?:dy)?|sister|brother|aunt|uncle|son|daughter|family|bff|neighbor|couch|roommate|teacher|student|doctor|patient|pornstars?|categories?|tags?)\b/i;

/** Strict shape gate shared by ingestion and every API response. */
function hasPerformerShape(value: string): boolean {
  const name = value.trim();
  return Boolean(name) && name.length <= 80 && !PERFORMER_BLOCKLIST.test(name) && !(/[^\p{L}\s]/u.test(name)) && name.split(/\s+/).length <= 3;
}

/** Dynamic whitelist populated from the verified performer records in the catalog. */
export const PERFORMER_WHITELIST = new Set<string>();

export function isVerifiedPerformerName(value: string): boolean {
  const name = value.trim();
  if (!hasPerformerShape(name)) return false;
  if (PERFORMER_WHITELIST.size === 0) {
    const rows = cached ?? getBackupVideos();
    for (const performer of rows.flatMap((video) => video.pornstars ?? [])) {
      if (hasPerformerShape(performer)) PERFORMER_WHITELIST.add(performer.toLowerCase());
    }
  }
  return PERFORMER_WHITELIST.has(name.toLowerCase());
}

function verifiedPerformers(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(isVerifiedPerformerName))];
}

export function getBackupVideos(): BackupVideo[] {
  if (!cached) {
    const backupPath = BACKUP_PATHS.find((candidate) => fs.existsSync(candidate));
    if (!backupPath) throw new Error("backup.json was not found");
    const raw = fs.readFileSync(backupPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("backup.json must contain an array");
    cached = parsed.filter((video): video is BackupVideo => Boolean(video && typeof video === "object"));
    PERFORMER_WHITELIST.clear();
    for (const performer of cached.flatMap((video) => video.pornstars ?? [])) {
      if (hasPerformerShape(performer)) PERFORMER_WHITELIST.add(performer.trim().toLowerCase());
    }
    cached = cached.map((video) => {
      const repaired = repairEmbedUrl(video);
      return {
        ...video,
        embed_url: repaired,
        primaryEmbedUrl: repaired,
        embedUrl: repaired,
        pornstars: verifiedPerformers(video.pornstars),
      };
    });
  }
  return cached;
}

export function findBackupVideo(slug: string) {
  return getBackupVideos().find((video) => video.slug === slug);
}

export function backupCategories() {
  const map = new Map<string, { name: string; video_count: number; candidates: { url: string; views: number }[] }>();
  for (const video of getBackupVideos()) {
    const labels = [video.category, ...video.tags].filter(Boolean).map((label) => label.trim().toLowerCase());
    for (const name of new Set(labels)) {
      const current = map.get(name) ?? { name, video_count: 0, candidates: [] };
      current.video_count += 1;
      if (video.thumbnail_url) current.candidates.push({ url: video.thumbnail_url, views: video.views ?? 0 });
      map.set(name, current);
    }
  }
  const usedThumbnails = new Set<string>();
  return [...map.values()]
    .sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name))
    .map(({ candidates, ...category }) => {
      const thumbnail_url = candidates.sort((a, b) => b.views - a.views).find(({ url }) => !usedThumbnails.has(url))?.url ?? null;
      if (thumbnail_url) usedThumbnails.add(thumbnail_url);
      return { ...category, thumbnail_url };
    });
}

export function backupPerformers() {
  const map = new Map<string, { name: string; slug: string; video_count: number; total_views: number; photo: string | null }>();
  for (const video of getBackupVideos()) {
    for (const raw of video.pornstars ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const current = map.get(key) ?? { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), video_count: 0, total_views: 0, photo: video.thumbnail_url };
      current.video_count += 1;
      current.total_views += video.views ?? 0;
      if (!current.photo) current.photo = video.thumbnail_url;
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name));
}
