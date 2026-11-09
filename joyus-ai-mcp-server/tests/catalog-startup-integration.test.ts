import type { Server } from 'node:http';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { resetCatalogRuntimeForTests } from '../src/skills/catalog/runtime.js';
import { mountCatalogRefreshRoutes } from '../src/skills/catalog/startup.js';

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
  resetCatalogRuntimeForTests();
  delete process.env.CATALOG_REFRESH_AUTH_SECRET_ALIAS;
  delete process.env.CATALOG_CURSOR_KEY_ALIAS;
  delete process.env.CATALOG_POLICY_BUCKET;
  delete process.env.CATALOG_POLICY_REGION;
  delete process.env.CATALOG_POLICY_KEY;
});

function buildAppReachableWithoutCatalog(env: NodeJS.ProcessEnv): express.Express {
  const app = express();
  mountCatalogRefreshRoutes(app, env);
  app.use(express.json());
  app.get('/health/platform', (_req, res) => res.json({ status: 'ok' }));
  return app;
}

async function listen(app: express.Express): Promise<string> {
  return new Promise<string>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      activeServer = server;
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('catalog startup wiring (T008)', () => {
  it('leaves an unrelated tool reachable and starts even without catalog configuration', async () => {
    const app = buildAppReachableWithoutCatalog({});
    const baseUrl = await listen(app);

    const health = await fetch(`${baseUrl}/health/platform`);
    expect(health.status).toBe(200);

    // No env configured: mountCatalogRefreshRoutes is a no-op, so the refresh route 404s
    // via Express's default handler rather than ever touching the catalog service.
    const refresh = await fetch(`${baseUrl}/internal/org-skills/refresh`, { method: 'POST' });
    expect(refresh.status).toBe(404);
  });

  it('mounts the refresh route and returns its own auth failure (never the global body parser) when configured', async () => {
    const env: NodeJS.ProcessEnv = {
      POLICY_SERVICE_URL: 'http://policy.example',
      POLICY_SERVICE_TOKEN: 'example-service-token-for-tests',
      CATALOG_CURSOR_KEY: 'a'.repeat(64),
      CATALOG_REFRESH_AUTH_SECRET_ALIAS: 'CATALOG_REFRESH_SECRET',
      CATALOG_CURSOR_KEY_ALIAS: 'CATALOG_CURSOR_KEY',
      CATALOG_POLICY_BUCKET: 'example-bucket',
      CATALOG_POLICY_REGION: 'us-east-1',
      CATALOG_POLICY_KEY: 'example-policy-key.json',
      CATALOG_REFRESH_SECRET: 'example-refresh-secret-value',
      CATALOG_REFRESH_TENANT_ID: 'tenant-a',
    };
    const app = buildAppReachableWithoutCatalog(env);
    const baseUrl = await listen(app);

    const health = await fetch(`${baseUrl}/health/platform`);
    expect(health.status).toBe(200);

    // Mounted before express.json(): an unauthenticated request is rejected by the
    // catalog's own auth check, not by (or before reaching) the global JSON parser.
    const refresh = await fetch(`${baseUrl}/internal/org-skills/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });
    expect(refresh.status).toBe(401);
  });
});
