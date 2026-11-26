import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);

function toPublicShareOrigin(rawOrigin: string): string {
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.hostname.startsWith('ais-dev-')) {
      parsed.hostname = parsed.hostname.replace(/^ais-dev-/, 'ais-pre-');
    }
    return parsed.origin;
  } catch {
    return rawOrigin.replace('://ais-dev-', '://ais-pre-');
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverTime: Date.now() });
});

app.get('/api/config', (req, res) => {
  const envOrigin = process.env.PUBLIC_APP_URL || process.env.APP_URL || '';
  const hostHeader = req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
  const protoHeader = req.get('x-forwarded-proto') || req.protocol || 'https';
  const requestOrigin = `${protoHeader.split(',')[0].trim()}://${hostHeader.split(',')[0].trim()}`;
  const rawBase = envOrigin && envOrigin.startsWith('http') ? envOrigin : requestOrigin;
  res.json({
    shareBaseUrl: toPublicShareOrigin(rawBase),
  });
});

async function startServer(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TECH AUCTION 2026 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
