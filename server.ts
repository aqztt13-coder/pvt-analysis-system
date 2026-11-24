import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { startBackupScheduler } from './src/server/backup';
import { loadAppConfig } from './src/server/config';
import { bootstrapInitialAdminFromEnv, getDb } from './src/server/db';
import { createApiRouter } from './src/server/routes';

dotenv.config();

async function startServer() {
  const app = express();
  const cfg = loadAppConfig();
  const port = cfg.port;
  const host = cfg.host;

  // Ensure SQLite database initializes cleanly, runs data-preserving migrations, and handles optional first-run admin bootstrap
  const db = getDb();
  bootstrapInitialAdminFromEnv(db);
  startBackupScheduler();

  // Security headers (iframe-compatible in AI Studio preview while preventing MIME sniffing)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Mount REST API
  app.use('/api', createApiRouter());

  // Safe JSON error handler (never leak stack traces to end users)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server Error]', err.message);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً أو مراجعة مدير النظام.' });
  });

  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distDir, 'index.html'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`[PVT Admin System] Server running at http://${host}:${port}`);
  });

  // Graceful shutdown for SQLite WAL checkpoint safety
  const shutdown = () => {
    console.log('[PVT Admin System] Shutting down gracefully...');
    server.close(() => {
      try {
        const db = getDb();
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[PVT Admin System] Failed to start:', err);
  process.exit(1);
});
