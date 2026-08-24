import fs from 'node:fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const port = 3000;
const basePath = process.env.BASE_PATH ?? '/';

type BackupVideo = Record<string, unknown> & {
  id: number;
  slug: string;
  title: string;
  embed_url?: string | null;
  thumbnail_url?: string | null;
  status?: string;
  category?: string;
  studio?: string;
  tags?: string[];
  pornstars?: string[];
};

let backupVideos: BackupVideo[] | undefined;
function getBackupVideos() {
  if (!backupVideos) {
    const backupPath = path.resolve(import.meta.dirname, '..', 'api-server', 'backup.json');
    backupVideos = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as BackupVideo[];
  }
  return backupVideos;
}

function backupResponse(res: import('node:http').ServerResponse, payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function backupCatalogMiddleware(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) {
  if (process.env.DATABASE_URL || !req.url?.startsWith('/api/pf/')) return next();
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const route = parsed.pathname.replace(/^\/api\/pf\/?/, '');
    const videos = getBackupVideos()
      .filter((video) => video.status !== 'deleted')
      .map((video) => {
        const thumbnail = video.thumbnail_url?.replace(/^http:\/\//i, 'https://') ?? null;
        return {
          ...video,
          thumbnail_url: thumbnail,
          thumbnailUrl: thumbnail,
          cover_url: thumbnail,
          coverUrl: thumbnail,
        };
      });
    if (route === 'videos') {
      const page = Math.max(1, Number(parsed.searchParams.get('page') ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(parsed.searchParams.get('limit') ?? 24) || 24));
      const query = parsed.searchParams.get('q')?.trim().toLowerCase();
      const category = parsed.searchParams.get('category')?.toLowerCase();
      const studio = parsed.searchParams.get('studio')?.toLowerCase();
      const performer = (parsed.searchParams.get('performer') ?? parsed.searchParams.get('pornstar'))?.trim().toLowerCase();
      const tag = parsed.searchParams.get('tag')?.replace(/^#/, '').toLowerCase();
      const filtered = videos.filter((video) =>
        (!query || `${video.title} ${video.description ?? ''}`.toLowerCase().includes(query)) &&
        (!category || video.category?.toLowerCase() === category || video.tags?.some((value) => value.toLowerCase() === category)) &&
        (!studio || video.studio?.toLowerCase() === studio) &&
        (!performer || video.pornstars?.some((value) => {
          const candidate = value.trim().toLowerCase();
          return candidate === performer || candidate.includes(performer);
        })) &&
        (!tag || video.tags?.some((value) => value.toLowerCase() === tag)),
      );
      const start = (page - 1) * limit;
      backupResponse(res, { data: filtered.slice(start, start + limit), pagination: { page, limit, total: filtered.length, pages: Math.ceil(filtered.length / limit) } });
      return;
    }
    if (route === 'browse/categories') {
      const counts = new Map<string, { name: string; video_count: number; candidates: { url: string; views: number }[] }>();
      for (const video of videos) for (const label of [video.category, ...(video.tags ?? [])]) if (label) {
        const key = label.trim().toLowerCase();
        const current = counts.get(key) ?? { name: key, video_count: 0, candidates: [] };
        current.video_count += 1;
        if (video.thumbnail_url) current.candidates.push({ url: video.thumbnail_url, views: Number(video.views ?? 0) });
        counts.set(key, current);
      }
      const assignedThumbnails = new Set<string>();
      const data = [...counts.values()]
        .sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name))
        .map(({ candidates, ...row }) => {
          const photo = candidates.sort((a, b) => b.views - a.views).find(({ url }) => !assignedThumbnails.has(url))?.url ?? null;
          if (photo) assignedThumbnails.add(photo);
          return { ...row, photo };
        });
      backupResponse(res, { data }); return;
    }
    if (route === 'browse/pornstars') {
      const counts = new Map<string, { name: string; slug: string; video_count: number; total_views: number; photo: string | null; top_views: number }>();
      for (const video of videos) for (const raw of video.pornstars ?? []) if (raw.trim()) {
        const name = raw.trim(), key = name.toLowerCase();
        const views = Number(video.views ?? 0);
        const current = counts.get(key) ?? { name, slug: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), video_count: 0, total_views: 0, photo: null, top_views: -1 };
        current.video_count += 1; current.total_views += views;
        if (views > current.top_views) { current.top_views = views; current.photo = video.thumbnail_url ?? null; }
        counts.set(key, current);
      }
      backupResponse(res, { data: [...counts.values()].sort((a, b) => b.video_count - a.video_count) }); return;
    }
    const detail = route.match(/^videos\/(.+)$/);
    if (detail) {
      const video = videos.find((item) => item.slug === decodeURIComponent(detail[1]));
      backupResponse(res, video ? { data: { ...video, primaryEmbedUrl: video.embed_url, embedUrl: video.embed_url, mirrors: video.mirrors ?? [] } } : { error: 'Video not found' }, video ? 200 : 404); return;
    }
  } catch (error) {
    backupResponse(res, { error: error instanceof Error ? error.message : 'Backup catalog unavailable' }, 500); return;
  }
  next();
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    {
      name: 'backup-catalog-middleware',
      configureServer(server) {
        server.middlewares.use('/api/pf/thumb', async (req, res) => {
          try {
            const targetUrl = new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
            if (!targetUrl) {
              res.statusCode = 400;
              return res.end('Missing url');
            }
            const decodedUrl = targetUrl.replace(/^http:\/\//i, 'https://');
            const origin = new URL(decodedUrl).origin;
            const response = await fetch(decodedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: `${origin}/`,
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              },
            });
            if (!response.ok) throw new Error('Fetch failed');
            const arrayBuffer = await response.arrayBuffer();
            res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.end(Buffer.from(arrayBuffer));
          } catch {
            res.statusCode = 404;
            return res.end();
          }
        });
        server.middlewares.use(backupCatalogMiddleware);
      },
    },
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api/pf': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/pf/, '/api'),
      },
    },
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
