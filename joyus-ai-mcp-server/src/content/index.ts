/**
 * Content Module Entry Point
 *
 * Initializes all content services and mounts routes into the Express app.
 * Failure is isolated — content module errors do not crash the server.
 */

import type { Express } from 'express';
import type { DrizzleClient } from './types.js';

import { connectorRegistry } from './connectors/index.js';
import { PgFtsProvider, SearchService } from './search/index.js';
import { EntitlementCache, EntitlementService, HttpEntitlementResolver } from './entitlements/index.js';
import { GenerationService, type SearchService as GenSearchService } from './generation/index.js';
import { SyncEngine, initializeSyncScheduler } from './sync/index.js';
import { HealthChecker } from './monitoring/health.js';
import { MetricsCollector } from './monitoring/metrics.js';
import { DriftMonitor } from './monitoring/drift.js';
import { createMonitoringRouter } from './monitoring/routes.js';
import { createMediationRouter } from './mediation/router.js';
import {
  createGenerationProviderFromEnv,
  createVoiceAnalyzerFromEnv,
  describeProviderWiring,
  enforceProviderReadiness,
} from './runtime-config.js';

export interface ContentModuleConfig {
  db: DrizzleClient;
}

export async function initializeContentModule(
  app: Express,
  config: ContentModuleConfig,
): Promise<void> {
  const { db } = config;

  try {
    // 1. Search
    const searchProvider = new PgFtsProvider(db);
    const searchService = new SearchService(searchProvider, db);

    // 2. Entitlements
    const entitlementCache = new EntitlementCache();
    const entitlementResolver = new HttpEntitlementResolver({
      name: 'default',
      defaultTtlSeconds: 300,
      baseUrl: process.env.ENTITLEMENT_RESOLVER_URL ?? 'http://localhost:4000',
      endpoint: '/entitlements',
      method: 'GET',
      authType: process.env.ENTITLEMENT_RESOLVER_API_KEY ? 'api-key' : 'none',
      authValue: process.env.ENTITLEMENT_RESOLVER_API_KEY,
      timeoutMs: 2000,
      responseMapping: { productsField: 'products' },
    });
    const entitlementService = new EntitlementService(entitlementResolver, entitlementCache, db);

    // 3. Generation (bridge search service to generation's expected interface)
    const generationProvider = createGenerationProviderFromEnv(process.env);
    const generationService = new GenerationService(
      searchService as unknown as GenSearchService,
      generationProvider,
      db,
    );

    // 4. Sync
    const syncEngine = new SyncEngine(db, connectorRegistry);

    // 5. Monitoring (use module-level db from db/client.js)
    const voiceAnalyzer = createVoiceAnalyzerFromEnv(process.env);
    enforceProviderReadiness(generationProvider, voiceAnalyzer, process.env);

    const healthChecker = new HealthChecker(
      describeProviderWiring(generationProvider, voiceAnalyzer, process.env),
    );
    const metricsCollector = new MetricsCollector();
    const driftMonitor = new DriftMonitor(voiceAnalyzer, db);

    // 6. Background jobs (gated on env vars)
    if (process.env.CONTENT_SYNC_ENABLED === 'true') {
      initializeSyncScheduler(syncEngine);
    }
    if (process.env.CONTENT_DRIFT_ENABLED === 'true') {
      driftMonitor.start();
    }

    // 7. Mount routes
    app.use('/api/content', createMonitoringRouter(healthChecker, metricsCollector));
    app.use(
      '/api/mediation',
      createMediationRouter({ db, entitlementService, generationService, entitlementCache }),
    );

    console.log('[content] Module initialized successfully');
  } catch (err) {
    // Log but do not crash — content module failure must not take down the server
    console.error('[content] Module initialization failed:', err);
  }
}
