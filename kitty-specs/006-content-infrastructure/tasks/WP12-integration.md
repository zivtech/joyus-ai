---
work_package_id: WP12
title: Integration Tests & Server Wiring
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T13:01:55.684417+00:00'
subtasks: [T054, T055, T056, T057, T058]
shell_pid: "27087"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP12: Integration Tests & Server Wiring

## Objective

Wire the content module into the server startup sequence and create integration tests covering the full content pipeline, mediation flow, entitlement enforcement, and drift monitoring.

## Implementation Command

```bash
spec-kitty implement WP12 --base WP11
```

(All previous WPs must be merged.)

## Context

- **All prior WPs**: This is the final integration layer
- **Existing server**: `src/index.ts` — Express app with auth routes, tools, scheduler
- **Test infrastructure**: Vitest, existing test patterns in `tests/`

This WP brings everything together: initialize content services, mount routers, and verify the full system works end-to-end.

---

## Subtask T054: Wire Content Module into Server Startup

**Purpose**: Initialize all content services and mount routes when the server starts.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/index.ts` — the content module entry point:
   ```typescript
   import { db } from '../db/client.js';
   import { connectorRegistry } from './connectors/index.js';
   import { SyncEngine } from './sync/engine.js';
   import { initializeSyncScheduler } from './sync/scheduler.js';
   import { PgFtsProvider } from './search/pg-fts-provider.js';
   import { SearchService } from './search/index.js';
   import { EntitlementService, EntitlementCache } from './entitlements/index.js';
   import { HttpEntitlementResolver } from './entitlements/http-resolver.js';
   import { GenerationService } from './generation/index.js';
   import { ContentRetriever } from './generation/retriever.js';
   import { ContentGenerator } from './generation/generator.js';
   import { CitationManager } from './generation/citations.js';
   import { DriftMonitor, StubVoiceAnalyzer } from './monitoring/drift.js';
   import { ContentLogger } from './monitoring/logger.js';
   import { HealthChecker } from './monitoring/health.js';
   import { MetricsCollector } from './monitoring/metrics.js';
   import { createMonitoringRouter } from './monitoring/routes.js';
   import { mediationRouter } from './mediation/router.js';

   export async function initializeContentModule(app: Express): Promise<void> {
     // 1. Initialize services
     const searchProvider = new PgFtsProvider(db);
     const searchService = new SearchService(searchProvider, db);
     const entitlementCache = new EntitlementCache();
     const entitlementResolver = new HttpEntitlementResolver(/* config from env */);
     const entitlementService = new EntitlementService(entitlementResolver, entitlementCache, db);
     const retriever = new ContentRetriever(searchService, db);
     const generator = new ContentGenerator(/* provider */);
     const citationManager = new CitationManager();
     const generationService = new GenerationService(retriever, generator, citationManager, db);
     const syncEngine = new SyncEngine(connectorRegistry, db);
     const logger = new ContentLogger(db);
     const healthChecker = new HealthChecker(/* deps */);
     const metricsCollector = new MetricsCollector(db);
     const driftMonitor = new DriftMonitor(new StubVoiceAnalyzer(), db);

     // 2. Start background jobs
     initializeSyncScheduler(syncEngine);
     driftMonitor.start();

     // 3. Mount routes
     app.use('/api/content', createMonitoringRouter(healthChecker, metricsCollector));
     app.use('/api/mediation', mediationRouter);

     console.log('[Content] Module initialized');
   }
   ```
2. Edit `joyus-ai-mcp-server/src/index.ts`:
   - Import `initializeContentModule`
   - Call it after existing initialization (after scheduler, after auth routes)
   - Wrap in try/catch so content module failure doesn't crash the entire server

**Files**:
- `joyus-ai-mcp-server/src/content/index.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/src/index.ts` (modify, ~10 lines)

**Validation**:
- [ ] Server starts without errors
- [ ] Content health endpoint accessible at `/api/content/health`
- [ ] Mediation routes accessible at `/api/mediation/*`
- [ ] Content tools appear in tool list
- [ ] Background sync scheduler running
- [ ] Existing functionality unaffected

---

## Subtask T055: Integration Tests — Content Pipeline

**Purpose**: End-to-end test: connect source → sync → search → generate.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/content/integration/pipeline.test.ts`
2. Test flow:
   ```typescript
   describe('Content Pipeline Integration', () => {
     it('connect → sync → search → generate', async () => {
       // 1. Create a content source (database type, mirror strategy)
       // 2. Mock the connector to return sample content
       // 3. Trigger sync, verify items indexed
       // 4. Search for content, verify results found
       // 5. Generate with content, verify citations present
     });

     it('hybrid sync fetches content on demand', async () => {
       // Source with hybrid strategy
       // After sync: metadata present, body null
       // After search + getItem: body fetched on demand
     });

     it('staleness detection flags old content', async () => {
       // Sync a source, advance time past freshness window
       // Run staleness detection, verify items flagged
     });
   });
   ```
3. Use Vitest with test database (or mock Drizzle client)
4. Mock external connectors (don't hit real databases/APIs in tests)

**Files**:
- `joyus-ai-mcp-server/tests/content/integration/pipeline.test.ts` (new, ~150 lines)

**Validation**:
- [ ] Full pipeline test passes
- [ ] Hybrid sync test passes
- [ ] Staleness test passes

---

## Subtask T056: Integration Tests — Mediation Flow

**Purpose**: End-to-end test: auth → session → message → response with citations.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/content/integration/mediation.test.ts`
2. Test flow:
   ```typescript
   describe('Mediation Flow Integration', () => {
     it('full mediation flow with valid credentials', async () => {
       // 1. Create API key
       // 2. POST /sessions with valid API key + mock JWT
       // 3. Verify session created with entitlements
       // 4. POST /sessions/:id/messages
       // 5. Verify response has citations
       // 6. DELETE /sessions/:id
     });

     it('rejects missing API key', async () => {
       // POST /sessions without X-API-Key → 401
     });

     it('rejects missing user token', async () => {
       // POST /sessions with API key but no Bearer token → 401
     });

     it('rejects invalid API key', async () => {
       // POST /sessions with wrong API key → 401
     });
   });
   ```
3. Mock JWT verification (don't need real OIDC provider in tests)

**Files**:
- `joyus-ai-mcp-server/tests/content/integration/mediation.test.ts` (new, ~120 lines)

**Validation**:
- [ ] Full flow test passes
- [ ] Auth rejection tests pass for all error types

---

## Subtask T057: Integration Tests — Entitlement Enforcement

**Purpose**: Verify zero unauthorized content exposure (SC-009).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/content/integration/entitlements.test.ts`
2. Test scenarios:
   ```typescript
   describe('Entitlement Enforcement', () => {
     it('search returns only entitled content', async () => {
       // User entitled to Product A (Source 1) but not Product B (Source 2)
       // Search returns results only from Source 1
     });

     it('getItem denies access to non-entitled content', async () => {
       // Try to fetch item from non-entitled source → null
     });

     it('generation only uses entitled sources', async () => {
       // Generate with partial entitlements
       // Verify citations only reference entitled sources
     });

     it('resolver failure falls back to restricted mode', async () => {
       // Mock resolver failure, no cached entitlements
       // Verify search returns empty, generation returns no content
     });

     it('mediation enforces entitlements per session', async () => {
       // Create session, verify only entitled content in responses
     });
   });
   ```

**Files**:
- `joyus-ai-mcp-server/tests/content/integration/entitlements.test.ts` (new, ~130 lines)

**Validation**:
- [ ] All 5 entitlement scenarios pass
- [ ] SC-009: Zero unauthorized content exposure verified

---

## Subtask T058: Integration Tests — Drift Monitoring

**Purpose**: Verify background drift monitoring produces reports.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/content/integration/drift.test.ts`
2. Test scenarios:
   ```typescript
   describe('Drift Monitoring', () => {
     it('evaluates unscored generations and produces report', async () => {
       // 1. Create generation_log entries with driftScore = null
       // 2. Run drift evaluation
       // 3. Verify driftScore populated on logs
       // 4. Verify DriftReport created
     });

     it('skips generations without profileId', async () => {
       // Create generation without profile → not evaluated
     });

     it('drift summary aggregates across profiles', async () => {
       // Multiple profiles with reports
       // Summary shows all with latest scores
     });
   });
   ```

**Files**:
- `joyus-ai-mcp-server/tests/content/integration/drift.test.ts` (new, ~80 lines)

**Validation**:
- [ ] Drift evaluation populates scores
- [ ] Reports generated correctly
- [ ] Summary aggregation works

---

## Definition of Done

- [ ] Content module initialized in server startup
- [ ] Routes mounted: `/api/content/health`, `/api/content/metrics`, `/api/mediation/*`
- [ ] Content tools registered and available
- [ ] Background jobs (sync scheduler, drift monitor) running
- [ ] Integration tests pass for all 4 test suites
- [ ] Existing server functionality unaffected
- [ ] `npm run validate` passes (typecheck + lint + all tests)

## Risks

- **Test database setup**: Integration tests need a database with the content schema. May need test setup/teardown scripts.
- **Service initialization order**: Services have dependencies — must initialize in correct order.

## Reviewer Guidance

- Verify server starts cleanly with content module
- Check that content module failure doesn't crash existing functionality
- Confirm all integration tests use mocks for external services
- Verify SC-009 entitlement tests cover all access paths (search, getItem, generate, mediate)
- Run `npm run validate` to confirm full test suite passes

## Activity Log

- 2026-02-21T13:32:02Z – unknown – shell_pid=27087 – lane=done – Integration tests & server wiring complete
