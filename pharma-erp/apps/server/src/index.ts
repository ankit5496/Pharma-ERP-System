import http from 'node:http';
import path from 'node:path';

import { createApiApp } from '@pharma-erp/api';
import next from 'next';

/**
 * Merged production entrypoint. Runs the Next.js web app and the NestJS API
 * in a single process, routed by path prefix, so Render bills and deploys
 * them as one web service instead of two. Only used in production — local
 * development still runs `apps/web` and `apps/api` as two separate processes
 * (see their own `dev` scripts), unchanged.
 */
async function main(): Promise<void> {
  const port = Number(process.env.PORT) || 3000;

  const nextApp = next({ dev: false, dir: path.resolve(__dirname, '../../web') });
  await nextApp.prepare();
  const nextHandler = nextApp.getRequestHandler();

  const apiApp = await createApiApp();
  // init(), not listen(): this brings the Nest app fully up (DB connections,
  // onModuleInit) without binding its own port — the http server below owns
  // the one port Render assigns.
  await apiApp.init();
  const apiHandler = apiApp.getHttpAdapter().getInstance();

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/') || req.url?.startsWith('/health')) {
      apiHandler(req, res);
    } else {
      void nextHandler(req, res);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console -- no logger set up in this thin entrypoint
    console.log(`Merged server listening on port ${port}`);
  });
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- nothing else is listening yet
  console.error('Failed to start merged server:', error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 3_000).unref();
});
