/**
 * Server startup/route-mounting glue (refresh.md's non-blocking-startup rule): the
 * catalog's refresh routes must be mounted before the global JSON body parser, and its
 * bounded background load must never be awaited on the critical startup path.
 */
import type { Express } from 'express';

import { createRefreshRoutes } from './refresh-routes.js';
import { getCatalogRuntime } from './runtime.js';

const REFRESH_ROUTE_PATH = '/internal/org-skills/refresh';

/** Mounts the refresh HTTP surface if the catalog is configured; a no-op otherwise. Must be
 * called before `app.use(express.json())` so refresh-routes.ts's own body cap applies. */
export function mountCatalogRefreshRoutes(
  app: Express,
  env: NodeJS.ProcessEnv = process.env
): void {
  const runtime = getCatalogRuntime(env);
  if (!runtime) return;
  app.use(
    REFRESH_ROUTE_PATH,
    createRefreshRoutes({ service: runtime.service, config: runtime.config, env })
  );
}

/** Starts the bounded catalog load and periodic timer in the background. Never awaited by
 * the caller and never throws: a missing/unavailable catalog leaves this feature idle. */
export function startCatalogBackgroundLoad(env: NodeJS.ProcessEnv = process.env): void {
  const runtime = getCatalogRuntime(env);
  if (!runtime) return;
  void runtime.service.runConfiguredRefresh('startup');
  runtime.service.startTimer();
}

/** Cancels timers, queued refreshes and in-flight fetches; a no-op if never configured. */
export function shutdownCatalog(env: NodeJS.ProcessEnv = process.env): void {
  const runtime = getCatalogRuntime(env);
  if (!runtime) return;
  runtime.service.shutdown();
}
