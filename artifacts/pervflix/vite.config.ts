import path from 'path';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import inMemoryApiRouter from '../api-server/src/routes/videos-memory';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

type ViteResponse = ServerResponse & {
  status: (code: number) => ViteResponse;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

const inMemoryApiMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => {
  const response = res as ViteResponse;
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
  };
  response.send = (body) => {
    response.end(body as string | Uint8Array);
  };

  const request = req as IncomingMessage & {
    query?: Record<string, string>;
  };
  request.query = Object.fromEntries(
    new URL(req.url ?? '/', 'http://vite.local').searchParams.entries(),
  );

  inMemoryApiRouter(request as never, response as never, next as never);
};

const inMemoryApiPlugin: Plugin = {
  name: 'pervflix-in-memory-api',
  configureServer(server) {
    server.middlewares.use('/api/pf', inMemoryApiMiddleware);
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    inMemoryApiPlugin,
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
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
