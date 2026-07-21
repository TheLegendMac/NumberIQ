import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes/api.js';
import { getDb } from './db/index.js';
import { DrawRepository } from './db/repositories.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5178);
// Local-first: bind to loopback only. This app is never exposed to a network.
const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '60mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, draws: new DrawRepository(getDb()).totalCount() });
});

app.use('/api', api);

// Serve the built SPA in production.
const webDist = join(HERE, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

interface HttpError extends Error {
  status?: number;
}

app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_failed',
      message: 'Request did not match the expected shape.',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const status = err.status ?? 500;
  if (status >= 500) console.error('[numberiq]', err);
  res.status(status).json({ error: 'request_failed', message: err.message });
});

getDb();
app.listen(PORT, HOST, () => {
  console.log(`\n  NumberIQ server → http://${HOST}:${PORT}`);
  console.log(`  Local-first. No accounts, no cloud, no telemetry.\n`);
});
