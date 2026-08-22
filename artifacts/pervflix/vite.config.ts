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
    const videos = getBackupVideos().filter((video) => video.status !== 'deleted');
    if (route === 'videos') {
      const page = Math.max(1, Number(parsed.searchParams.get('page') ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(parsed.searchParams.get('limit') ?? 24) || 24));
      const query = parsed.searchParams.get('q')?.trim().toLowerCase();
      const category = parsed.searchParams.get('category')?.toLowerCase();
      const studio = parsed.searchParams.get('studio')?.toLowerCase();
      const pornstar = parsed.searchParams.get('pornstar')?.toLowerCase();
      const tag = parsed.searchParams.get('tag')?.replace(/^#/, '').toLowerCase();
      const filtered = videos.filter((video) =>
        (!query || `${video.title} ${video.description ?? ''}`.toLowerCase().includes(query)) &&
        (!category || video.category?.toLowerCase() === category || video.tags?.some((value) => value.toLowerCase() === category)) &&
        (!studio || video.studio?.toLowerCase() === studio) &&
        (!pornstar || video.pornstars?.some((value) => value.toLowerCase() === pornstar)) &&
        (!tag || video.tags?.some((value) => value.toLowerCase() === tag)),
      );
      const start = (page - 1) * limit;
      backupResponse(res, { data: filtered.slice(start, start + limit), pagination: { page, limit, total: filtered.length, pages: Math.ceil(filtered.length / limit) } });
      return;
    }
    if (route === 'browse/categories') {
      const counts = new Map<string, { name: string; video_count: number; thumbnail_url: string | null }>();
      for (const video of videos) for (const label of [video.category, ...(video.tags ?? [])]) if (label) {
        const key = label.trim().toLowerCase();
        const current = counts.get(key) ?? { name: key, video_count: 0, thumbnail_url: video.thumbnail_url ?? null };
        current.video_count += 1; counts.set(key, current);
      }
      backupResponse(res, { data: [...counts.values()].sort((a, b) => b.video_count - a.video_count) }); return;
    }
    if (route === 'browse/pornstars') {
      const counts = new Map<string, { name: string; slug: string; video_count: number; total_views: number; photo: string | null }>();
      for (const video of videos) for (const raw of video.pornstars ?? []) if (raw.trim()) {
        const name = raw.trim(), key = name.toLowerCase();
        const current = counts.get(key) ?? { name, slug: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), video_count: 0, total_views: 0, photo: video.thumbnail_url ?? null };
        current.video_count += 1; current.total_views += Number(video.views ?? 0); counts.set(key, current);
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
