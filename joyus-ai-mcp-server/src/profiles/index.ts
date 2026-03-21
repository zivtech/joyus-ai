/**
 * Profiles Module Entry Point
 *
 * Initializes all profile services in dependency order and returns a typed
 * module object. Parsers are registered at startup. All services are
 * stateless and share no mutable module-level state.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';

import { ProfileVersionService } from './versioning/service.js';
import { ProfileVersionHistory } from './versioning/history.js';
import { ProfileGenerationPipeline } from './generation/pipeline.js';
import { EngineBridge } from './generation/engine-bridge.js';
import { CorpusSnapshotService } from './generation/corpus-snapshot.js';
import { ProfileHierarchyService } from './inheritance/hierarchy.js';
import { InheritanceResolver } from './inheritance/resolver.js';
import { IntakeService } from './intake/service.js';
import { ParserRegistry } from './intake/parsers/registry.js';
import { TextParser } from './intake/parsers/text-parser.js';
import { PdfParser } from './intake/parsers/pdf-parser.js';
import { DocxParser } from './intake/parsers/docx-parser.js';
import { DeduplicationService } from './intake/dedup.js';
import { ProfileCacheService } from './cache/service.js';
import { CacheInvalidationService } from './cache/invalidation.js';
import { ProfileOperationLogger } from './monitoring/logger.js';
import { ProfileMetrics } from './monitoring/metrics.js';

// ============================================================
// TYPES
// ============================================================

type DrizzleClient = ReturnType<typeof drizzle>;

export interface ProfilesConfig {
  /** Path to the Python interpreter. Defaults to 'python3'. */
  pythonPath?: string;
  /** Absolute path to the stylometric engine entry script. */
  engineScriptPath?: string;
}

export interface ProfilesModule {
  versionService: ProfileVersionService;
  historyService: ProfileVersionHistory;
  pipeline: ProfileGenerationPipeline;
  engineBridge: EngineBridge;
  snapshotService: CorpusSnapshotService;
  hierarchyService: ProfileHierarchyService;
  resolver: InheritanceResolver;
  intakeService: IntakeService;
  cacheService: ProfileCacheService;
  invalidationService: CacheInvalidationService;
  logger: ProfileOperationLogger;
  metrics: ProfileMetrics;
  parserRegistry: ParserRegistry;
  dedupService: DeduplicationService;
}

// ============================================================
// INITIALIZER
// ============================================================

/**
 * Initialize the profiles module, wiring all services in dependency order.
 *
 * Dependency graph (simplified):
 *   logger, metrics           — no deps
 *   parserRegistry            — no deps (parsers registered here)
 *   dedupService              — db
 *   snapshotService           — no deps (uses global db internally)
 *   engineBridge              — config
 *   hierarchyService          — logger
 *   resolver                  — hierarchyService, logger
 *   versionService            — logger
 *   historyService            — no deps
 *   cacheService              — resolver, logger, metrics
 *   invalidationService       — hierarchyService, cacheService, logger
 *   intakeService             — db, parserRegistry (dedupService created internally)
 *   pipeline                  — engineBridge, snapshotService, logger, metrics
 */
export function initializeProfiles(
  db: DrizzleClient,
  config?: ProfilesConfig,
): ProfilesModule {
  // ── Layer 1: No-dependency singletons ─────────────────────────────────────

  const logger = new ProfileOperationLogger();
  const metrics = new ProfileMetrics();

  // ── Layer 2: Parser registry ───────────────────────────────────────────────

  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new TextParser());
  parserRegistry.register(new PdfParser());
  parserRegistry.register(new DocxParser());

  // ── Layer 3: Dedup + snapshot + engine bridge ──────────────────────────────

  const dedupService = new DeduplicationService(db as unknown as NodePgDatabase);
  const snapshotService = new CorpusSnapshotService();

  const engineBridge = new EngineBridge({
    pythonPath: config?.pythonPath ?? 'python3',
    engineScriptPath: config?.engineScriptPath ?? process.env.ENGINE_SCRIPT_PATH ?? '',
  });

  // ── Layer 4: Hierarchy + resolver ─────────────────────────────────────────

  const hierarchyService = new ProfileHierarchyService(logger);
  const resolver = new InheritanceResolver(hierarchyService, logger);

  // ── Layer 5: Version services ──────────────────────────────────────────────

  const versionService = new ProfileVersionService(logger);
  const historyService = new ProfileVersionHistory();

  // ── Layer 6: Cache services ────────────────────────────────────────────────

  const cacheService = new ProfileCacheService(resolver, logger, metrics);
  const invalidationService = new CacheInvalidationService(
    hierarchyService,
    cacheService,
    logger,
  );

  // ── Layer 7: Intake ────────────────────────────────────────────────────────

  const intakeService = new IntakeService(
    db as unknown as NodePgDatabase,
    parserRegistry,
  );

  // ── Layer 8: Pipeline ─────────────────────────────────────────────────────

  const pipeline = new ProfileGenerationPipeline(
    engineBridge,
    snapshotService,
    logger,
    metrics,
  );

  return {
    versionService,
    historyService,
    pipeline,
    engineBridge,
    snapshotService,
    hierarchyService,
    resolver,
    intakeService,
    cacheService,
    invalidationService,
    logger,
    metrics,
    parserRegistry,
    dedupService,
  };
}
