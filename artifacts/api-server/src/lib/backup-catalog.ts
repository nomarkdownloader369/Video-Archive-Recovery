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
};

const BACKUP_PATHS = [
  path.resolve(process.cwd(), "artifacts/api-server/backup.json"),
  path.resolve(process.cwd(), "backup.json"),
];
let cached: BackupVideo[] | null = null;

export function getBackupVideos(): BackupVideo[] {
  if (!cached) {
    const backupPath = BACKUP_PATHS.find((candidate) => fs.existsSync(candidate));
    if (!backupPath) throw new Error("backup.json was not found");
    const raw = fs.readFileSync(backupPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("backup.json must contain an array");
    cached = parsed.filter((video): video is BackupVideo => Boolean(video && typeof video === "object"));
  }
  return cached;
}

export function findBackupVideo(slug: string) {
  return getBackupVideos().find((video) => video.slug === slug);
}

export function backupCategories() {
  const map = new Map<string, { name: string; video_count: number; thumbnail_url: string | null }>();
  for (const video of getBackupVideos()) {
    const labels = [video.category, ...video.tags].filter(Boolean).map((label) => label.trim().toLowerCase());
    for (const name of new Set(labels)) {
      const current = map.get(name) ?? { name, video_count: 0, thumbnail_url: video.thumbnail_url };
      current.video_count += 1;
      if (!current.thumbnail_url) current.thumbnail_url = video.thumbnail_url;
      map.set(name, current);
    }
  }
  return [...map.values()].sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name));
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
