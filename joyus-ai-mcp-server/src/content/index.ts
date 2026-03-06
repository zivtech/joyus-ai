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
import {
  GenerationService,
  PlaceholderGenerationProvider,
  HttpGenerationProvider,
  type SearchService as GenSearchService,
} from './generation/index.js';
import { SyncEngine, initializeSyncScheduler } from './sync/index.js';
import { HealthChecker } from './monitoring/health.js';
import { MetricsCollector } from './monitoring/metrics.js';
import { DriftMonitor } from './monitoring/drift.js';
import { StubVoiceAnalyzer, HttpVoiceAnalyzer } from './monitoring/voice-analyzer.js';
import { createMonitoringRouter } from './monitoring/routes.js';
import { createMediationRouter } from './mediation/router.js';
import { ProfileIngestionQueue } from './profiles/ingestion-queue.js';

export interface ContentModuleConfig {
  db: DrizzleClient;
}

type ProviderWiringStatus = {
  generationProvider: 'real' | 'placeholder';
  voiceAnalyzer: 'real' | 'stub';
};

function createGenerationProvider() {
  const mode = process.env.CONTENT_GENERATION_PROVIDER
    ?? (process.env.CONTENT_GENERATION_PROVIDER_URL ? 'http' : 'placeholder');

  if (mode === 'http') {
    const url = process.env.CONTENT_GENERATION_PROVIDER_URL;
    if (!url) {
      throw new Error(
        'CONTENT_GENERATION_PROVIDER=http requires CONTENT_GENERATION_PROVIDER_URL',
      );
    }
    return {
      provider: new HttpGenerationProvider({
        url,
        timeoutMs: Number(process.env.CONTENT_GENERATION_PROVIDER_TIMEOUT_MS ?? 10000),
        apiKey: process.env.CONTENT_GENERATION_PROVIDER_API_KEY,
      }),
      status: 'real' as const,
    };
  }

  return {
    provider: new PlaceholderGenerationProvider(),
    status: 'placeholder' as const,
  };
}

function createVoiceAnalyzer() {
  const mode = process.env.CONTENT_VOICE_ANALYZER_PROVIDER
    ?? (process.env.CONTENT_VOICE_ANALYZER_URL ? 'http' : 'stub');

  if (mode === 'http') {
    const url = process.env.CONTENT_VOICE_ANALYZER_URL;
    if (!url) {
      throw new Error(
        'CONTENT_VOICE_ANALYZER_PROVIDER=http requires CONTENT_VOICE_ANALYZER_URL',
      );
    }
    return {
      analyzer: new HttpVoiceAnalyzer({
        url,
        timeoutMs: Number(process.env.CONTENT_VOICE_ANALYZER_TIMEOUT_MS ?? 10000),
        apiKey: process.env.CONTENT_VOICE_ANALYZER_API_KEY,
      }),
      status: 'real' as const,
    };
  }

  return {
    analyzer: new StubVoiceAnalyzer(),
    status: 'stub' as const,
  };
}

function enforceProviderSafety(wiring: ProviderWiringStatus): void {
  const strictMode =
    process.env.NODE_ENV === 'production'
    || process.env.CONTENT_STRICT_INIT === 'true';
  const driftEnabled = process.env.CONTENT_DRIFT_ENABLED === 'true';

  if (strictMode && wiring.generationProvider === 'placeholder') {
    throw new Error(
      'Content module startup blocked: production/strict mode requires a real generation provider',
    );
  }

  if (driftEnabled && wiring.voiceAnalyzer === 'stub') {
    throw new Error(
      'Content module startup blocked: CONTENT_DRIFT_ENABLED=true requires a real voice analyzer',
    );
  }
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

    // 3. Generation + drift analyzer providers
    const generationProviderConfig = createGenerationProvider();
    const voiceAnalyzerConfig = createVoiceAnalyzer();
    const providerWiring: ProviderWiringStatus = {
      generationProvider: generationProviderConfig.status,
      voiceAnalyzer: voiceAnalyzerConfig.status,
    };
    enforceProviderSafety(providerWiring);

    // 4. Generation (explicitly bridge to retriever contract: query + sourceIds)
    const generationSearchAdapter: GenSearchService = {
      search: async (query, accessibleSourceIds, options) => {
        if (accessibleSourceIds.length === 0) {
          return [];
        }
        return searchProvider.search(query, accessibleSourceIds, {
          limit: options?.limit ?? 20,
          offset: 0,
        });
      },
    };
    const generationService = new GenerationService(
      generationSearchAdapter,
      generationProviderConfig.provider,
      db,
    );

    // 5. Sync
    const syncEngine = new SyncEngine(db, connectorRegistry);

    // 6. Monitoring (use module-level db from db/client.js)
    const profileIngestionQueue = new ProfileIngestionQueue(
      async () => {
        // Queue skeleton for WP03: actual profile-engine processing is injected in later milestones.
      },
      {
        maxQueueDepth: Number(process.env.CONTENT_PROFILE_QUEUE_MAX_DEPTH ?? 500),
        concurrency: Number(process.env.CONTENT_PROFILE_QUEUE_CONCURRENCY ?? 2),
        maxRetries: Number(process.env.CONTENT_PROFILE_QUEUE_MAX_RETRIES ?? 2),
        retryDelayMs: Number(process.env.CONTENT_PROFILE_QUEUE_RETRY_DELAY_MS ?? 250),
      },
    );

    const healthChecker = new HealthChecker(
      providerWiring,
      () => profileIngestionQueue.getMetrics(),
    );
    const metricsCollector = new MetricsCollector();
    const driftMonitor = new DriftMonitor(voiceAnalyzerConfig.analyzer, db);

    // 7. Background jobs (gated on env vars)
    if (process.env.CONTENT_SYNC_ENABLED === 'true') {
      initializeSyncScheduler(syncEngine);
    }
    if (process.env.CONTENT_DRIFT_ENABLED === 'true') {
      driftMonitor.start();
    }

    // 8. Mount routes
    app.use(
      '/api/content',
      createMonitoringRouter(
        healthChecker,
        metricsCollector,
        () => profileIngestionQueue.getMetrics(),
      ),
    );
    app.use(
      '/api/mediation',
      createMediationRouter({ db, entitlementService, generationService, entitlementCache }),
    );

    console.log(
      `[content] Module initialized successfully (generation=${providerWiring.generationProvider}, analyzer=${providerWiring.voiceAnalyzer})`,
    );
  } catch (err) {
    console.error('[content] Module initialization failed:', err);
    throw err;
  }
}
