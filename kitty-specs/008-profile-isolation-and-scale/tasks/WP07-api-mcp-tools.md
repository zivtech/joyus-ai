---
work_package_id: "WP07"
title: "Profile API & MCP Tools"
lane: "planned"
dependencies: ["WP02", "WP03", "WP04", "WP05", "WP06"]
subtasks: ["T032", "T033", "T034", "T035", "T036", "T037", "T038", "T039", "T040"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP07: Profile API & MCP Tools

**Implementation command**: `spec-kitty implement WP07 --base WP02,WP03,WP04,WP05,WP06`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (Access Control), WP03 (Versioning), WP04 (Batch Ingestion), WP05 (Caching), WP06 (Engine/Retraining)
**Priority**: P1 | T032-T035 (routes) and T036 (tools) are independent

## Objective

Implement the Express API routes (10 endpoints) and MCP tool definitions (7 tools) for profile management. Wire all profile submodules into a cohesive module entry point. Mount routes and register tools in the server's main entry point. All endpoints enforce tenant scoping via the existing auth middleware and `assertProfileAccessOrAudit()`.

## Context

The profile API follows the pattern established by the content infrastructure (Spec 006):
- Routes are defined in `src/profiles/routes.ts` as an Express `Router`
- MCP tools are defined in `src/profiles/tools.ts` following the `ToolDefinition` interface
- Routes use `req.tenantId` and `req.userId` from the auth middleware (set in `src/content/mediation/auth.ts`)
- Request bodies are validated with Zod schemas before processing
- All profile-specific routes call `assertProfileAccessOrAudit()` for tenant isolation

The MCP tools wrap the same service logic as the routes but are invoked by the MCP protocol layer rather than HTTP. They follow the existing tool registration pattern in `joyus-ai`.

**Route structure**:
```
POST   /api/profiles                           — Create profile
GET    /api/profiles                           — List profiles (tenant-scoped)
GET    /api/profiles/:id                       — Get profile details
PUT    /api/profiles/:id                       — Update profile metadata
DELETE /api/profiles/:id                       — Archive profile (soft delete)
GET    /api/profiles/:id/versions              — List versions
GET    /api/profiles/:id/versions/:version     — Get specific version
GET    /api/profiles/:id/diff/:vA/:vB          — Diff two versions
POST   /api/profiles/:id/retrain              — Trigger retraining
POST   /api/profiles/:id/pin                  — Pin a version
GET    /api/profiles/:id/audit                — Query audit log
```

---

## Subtasks

### T032: Implement profile CRUD routes (`src/profiles/routes.ts`)

**Purpose**: Create, list, get, update, and archive (soft-delete) profile endpoints.

**Steps**:
1. Create `src/profiles/routes.ts`
2. Implement `POST /api/profiles` — validate input, create profile, optionally trigger batch ingestion
3. Implement `GET /api/profiles` — list profiles for `req.tenantId`, include staleness info
4. Implement `GET /api/profiles/:id` — get profile with current version, staleness, pin status
5. Implement `PUT /api/profiles/:id` — update metadata fields only (not status or version)
6. Implement `DELETE /api/profiles/:id` — set `status: 'archived'`

```typescript
// src/profiles/routes.ts
import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { profiles } from './schema.js';
import { assertProfileAccessOrAudit } from './access/guard.js';
import { ProfileVersionManager } from './versioning/manager.js';
import { computeStaleness } from './versioning/staleness.js';
import { BatchIngestionManager } from './ingestion/batch.js';
import { createProfileSchema, updateProfileSchema } from './validation.js';
import { createId } from '@paralleldrive/cuid2';
import type { DrizzleClient } from '../content/types.js';

export function createProfileRoutes(deps: {
  db: DrizzleClient;
  versionManager: ProfileVersionManager;
  batchManager: BatchIngestionManager;
}): Router {
  const router = Router();

  // POST /api/profiles — Create a new profile
  router.post('/', async (req: Request, res: Response) => {
    const parsed = createProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
    }

    const { authorName, authorType, description, stalenessThresholdDays, metadata, documentIds } = parsed.data;

    const [profile] = await deps.db
      .insert(profiles)
      .values({
        id: createId(),
        tenantId: req.tenantId!,
        authorName,
        authorType,
        description: description ?? null,
        stalenessThresholdDays: stalenessThresholdDays ?? 30,
        metadata: metadata ?? {},
        status: documentIds?.length ? 'pending_training' : 'pending_training',
      })
      .returning();

    // If document IDs provided, create a batch ingestion job
    let jobId: string | undefined;
    if (documentIds?.length) {
      const job = await deps.batchManager.createJob({
        tenantId: req.tenantId!,
        profileId: profile.id,
        documentIds,
      });
      jobId = job.id;
    }

    // Log the creation in audit
    await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: profile.id,
      action: 'create',
    }).catch(() => {}); // Profile was just created, access is guaranteed

    res.status(201).json({ profile, jobId });
  });

  // GET /api/profiles — List profiles for tenant
  router.get('/', async (req: Request, res: Response) => {
    const tenantProfiles = await deps.db
      .select()
      .from(profiles)
      .where(eq(profiles.tenantId, req.tenantId!));

    const enriched = tenantProfiles.map((p) => ({
      ...p,
      staleness: computeStaleness(p),
    }));

    res.json({ profiles: enriched });
  });

  // GET /api/profiles/:id — Get profile details
  router.get('/:id', async (req: Request, res: Response) => {
    const profile = await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: req.params.id,
      action: 'read',
    });

    const currentVersion = profile.currentVersionNumber
      ? await deps.versionManager.getVersion(profile.id, profile.currentVersionNumber)
      : null;

    const pin = await deps.versionManager.getActivePin(profile.id, req.tenantId!);
    const staleness = computeStaleness(profile);

    res.json({ profile, currentVersion, pin, staleness });
  });

  // ... PUT /:id, DELETE /:id follow same pattern

  return router;
}
```

**Files**:
- `src/profiles/routes.ts` (new, ~200 lines)

**Validation**:
- [ ] `POST /api/profiles` creates profile and optionally starts batch ingestion
- [ ] `GET /api/profiles` returns only profiles for `req.tenantId` (never cross-tenant)
- [ ] `GET /api/profiles/:id` calls `assertProfileAccessOrAudit` before returning data
- [ ] `DELETE /api/profiles/:id` sets `status: 'archived'` (not hard delete)
- [ ] All routes return structured JSON responses
- [ ] `tsc --noEmit` passes

---

### T033: Implement version routes — list versions, get version, diff

**Purpose**: Routes for viewing and comparing profile versions.

**Steps**:
1. Add to `src/profiles/routes.ts`
2. `GET /api/profiles/:id/versions` — list all versions for a profile
3. `GET /api/profiles/:id/versions/:version` — get a specific version (version is an integer)
4. `GET /api/profiles/:id/diff/:vA/:vB` — compute diff between two versions

```typescript
  // GET /api/profiles/:id/versions
  router.get('/:id/versions', async (req: Request, res: Response) => {
    await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: req.params.id,
      action: 'read',
    });

    const versions = await deps.versionManager.getVersions(req.params.id);
    // Return versions WITHOUT featureVector (it's large and sensitive)
    const sanitized = versions.map(({ featureVector, ...rest }) => rest);
    res.json({ versions: sanitized });
  });

  // GET /api/profiles/:id/diff/:vA/:vB
  router.get('/:id/diff/:vA/:vB', async (req: Request, res: Response) => {
    await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: req.params.id,
      action: 'read',
    });

    const vA = parseInt(req.params.vA, 10);
    const vB = parseInt(req.params.vB, 10);
    if (isNaN(vA) || isNaN(vB)) {
      return res.status(400).json({ error: 'invalid_version', message: 'Version must be an integer' });
    }

    const versionA = await deps.versionManager.getVersion(req.params.id, vA);
    const versionB = await deps.versionManager.getVersion(req.params.id, vB);
    if (!versionA || !versionB) {
      return res.status(404).json({ error: 'version_not_found' });
    }

    const diff = computeProfileDiff(req.params.id, versionA, versionB);

    // Return diff WITHOUT full allChanges (can be very large)
    res.json({
      ...diff,
      allChanges: undefined,  // Omit full diff, only return significantChanges
    });
  });
```

**Files**:
- `src/profiles/routes.ts` (modified)

**Validation**:
- [ ] Version list does NOT include `featureVector` (sensitive, large)
- [ ] Diff endpoint returns `significantChanges` but NOT `allChanges` (API response size)
- [ ] Invalid version numbers return 400
- [ ] Non-existent versions return 404
- [ ] Access control checked before any version data is returned

---

### T034: Implement action routes — retrain, pin

**Purpose**: Routes for triggering retraining and pinning a version.

**Steps**:
1. Add to `src/profiles/routes.ts`
2. `POST /api/profiles/:id/retrain` — validate input, create batch ingestion job
3. `POST /api/profiles/:id/pin` — validate input, pin a version

```typescript
  // POST /api/profiles/:id/retrain
  router.post('/:id/retrain', async (req: Request, res: Response) => {
    await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: req.params.id,
      action: 'retrain',
    });

    const parsed = retrainProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
    }

    const job = await deps.batchManager.createJob({
      tenantId: req.tenantId!,
      profileId: req.params.id,
      documentIds: parsed.data.documentIds,
    });

    res.status(202).json({ jobId: job.id, status: 'pending' });
  });

  // POST /api/profiles/:id/pin
  router.post('/:id/pin', async (req: Request, res: Response) => {
    await assertProfileAccessOrAudit(deps.db, {
      tenantId: req.tenantId!,
      userId: req.userId!,
      profileId: req.params.id,
      action: 'pin',
    });

    const parsed = pinVersionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
    }

    const pin = await deps.versionManager.pinVersion({
      tenantId: req.tenantId!,
      profileId: req.params.id,
      versionNumber: parsed.data.versionNumber,
      pinnedBy: req.userId!,
      reason: parsed.data.reason,
    });

    res.json({ pin });
  });
```

**Files**:
- `src/profiles/routes.ts` (modified)

**Validation**:
- [ ] Retrain returns 202 (Accepted) with job ID
- [ ] Pin validates version exists before pinning
- [ ] Both routes call `assertProfileAccessOrAudit` with correct action types

---

### T035: Implement audit log query route

**Purpose**: Paginated, tenant-scoped audit log query.

**Steps**:
1. Add `GET /api/profiles/:id/audit` to routes
2. Validate query parameters with `auditLogQuerySchema`
3. Call `queryAuditLog` from the access module

**Files**:
- `src/profiles/routes.ts` (modified)

**Validation**:
- [ ] Query parameters validated (action filter, date range, pagination)
- [ ] Results are always scoped to `req.tenantId`
- [ ] Default limit is 50, max is 100

---

### T036: Implement MCP tool definitions (`src/profiles/tools.ts`)

**Purpose**: Define 7 MCP tools that expose profile operations to the MCP protocol layer.

**Steps**:
1. Create `src/profiles/tools.ts`
2. Define tools following the existing `ToolDefinition` interface pattern
3. Each tool validates input, enforces tenant scoping, and delegates to service methods

**Tools**:
- `profile_list` — `{ tenantId }` -> list of profiles with staleness
- `profile_get` — `{ profileId }` -> profile details, current version, pin, staleness
- `profile_create` — `{ authorName, authorType, description?, documentIds? }` -> created profile
- `profile_retrain` — `{ profileId, documentIds }` -> job ID
- `profile_versions` — `{ profileId }` -> version list (without feature vectors)
- `profile_diff` — `{ profileId, versionA, versionB }` -> diff summary
- `profile_status` — `{ profileId }` -> staleness, drift score, last retrained, cache status

```typescript
// src/profiles/tools.ts — abbreviated example for profile_list
export const profileTools = [
  {
    name: 'profile_list',
    description: 'List writing profiles for the current tenant with staleness information.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (params: Record<string, unknown>, context: ToolExecutionContext) => {
      const tenantProfiles = await deps.db
        .select()
        .from(profiles)
        .where(eq(profiles.tenantId, context.tenantId));

      return tenantProfiles.map((p) => ({
        id: p.id,
        authorName: p.authorName,
        authorType: p.authorType,
        status: p.status,
        currentVersion: p.currentVersionNumber,
        staleness: computeStaleness(p),
      }));
    },
  },
  // ... 6 more tools
];
```

**Files**:
- `src/profiles/tools.ts` (new, ~200 lines)

**Validation**:
- [ ] All 7 tools defined: profile_list, profile_get, profile_create, profile_retrain, profile_versions, profile_diff, profile_status
- [ ] Every tool that accesses a specific profile calls `assertProfileAccessOrAudit`
- [ ] `profile_list` filters by `context.tenantId` (never returns cross-tenant data)
- [ ] `profile_versions` omits `featureVector` from response
- [ ] `tsc --noEmit` passes

---

### T037: Enforce tenant scoping on all routes and tools

**Purpose**: Verify that every route and tool uses `req.tenantId` / `context.tenantId` and that no code path bypasses the access guard.

**Steps**:
1. Review all routes — confirm each calls `assertProfileAccessOrAudit` or scopes by `tenantId`
2. Review all tools — confirm each scopes by `context.tenantId`
3. List route `GET /api/profiles` uses WHERE `tenantId = req.tenantId` (not the guard, since it lists many profiles)

**Files**:
- No new files — verification task

**Validation**:
- [ ] Every route that takes a `:id` param calls `assertProfileAccessOrAudit`
- [ ] List route (`GET /api/profiles`) filters by `req.tenantId` in the WHERE clause
- [ ] No route or tool returns data from another tenant under any input combination

---

### T038: Create module entry point with initialization (`src/profiles/index.ts`)

**Purpose**: Wire all submodules together in the module entry point. Create factory function that initializes all dependencies.

**Steps**:
1. Update `src/profiles/index.ts` to export an `initializeProfileModule` function
2. The function creates all managers, services, and listeners with their dependencies
3. Returns the router, tools, and a `start`/`stop` interface for background processes

```typescript
// src/profiles/index.ts — module initialization
export function initializeProfileModule(deps: {
  db: DrizzleClient;
  engineClient?: ProfileEngineClient;
}) {
  const engineClient = deps.engineClient ?? new NullProfileEngineClient();
  const cache = new ProfileCacheService();
  const versionManager = new ProfileVersionManager(deps.db, cache);
  const documentProcessor = new DocumentProcessor(deps.db, engineClient);
  const batchManager = new BatchIngestionManager(deps.db, versionManager, documentProcessor);
  const retrainingWorker = new RetrainingWorker(deps.db, versionManager, batchManager, engineClient);
  const driftListener = new DriftRetrainingListener(deps.db, async (params) => {
    await retrainingWorker.retrain({ ...params, triggeredBy: 'drift' });
  });

  const router = createProfileRoutes({ db: deps.db, versionManager, batchManager });
  const tools = createProfileTools({ db: deps.db, versionManager, batchManager, cache });

  return {
    router,
    tools,
    start: () => {
      batchManager.start();
      driftListener.start();
    },
    stop: () => {
      batchManager.stop();
      driftListener.stop();
    },
  };
}
```

**Files**:
- `src/profiles/index.ts` (modified)

**Validation**:
- [ ] `initializeProfileModule` wires all dependencies correctly
- [ ] Uses `NullProfileEngineClient` when no real client is provided
- [ ] `start()` activates background processes (batch polling, drift listening)
- [ ] `stop()` cleanly shuts down background processes

---

### T039: Mount profile routes and register tools in `src/index.ts`

**Purpose**: Connect the profile module to the Express server and MCP tool registry.

**Steps**:
1. Open `src/index.ts` (existing file)
2. Import and call `initializeProfileModule`
3. Mount router at `/api/profiles`
4. Register MCP tools

**Files**:
- `src/index.ts` (modified)

**Validation**:
- [ ] `curl http://localhost:3000/api/profiles` returns a list (empty if no profiles)
- [ ] Profile MCP tools appear in the tool registry
- [ ] Existing routes and tools continue to work

---

### T040: Unit tests for routes and tools

**Purpose**: Test route handlers and MCP tool definitions.

**Test cases**:
- `POST /api/profiles` with valid input -> 201 with profile
- `POST /api/profiles` with missing authorName -> 400
- `GET /api/profiles` -> returns only tenant's profiles
- `GET /api/profiles/:id` for wrong tenant -> 404
- `DELETE /api/profiles/:id` -> status changed to archived
- `POST /api/profiles/:id/retrain` -> 202 with job ID
- `POST /api/profiles/:id/pin` with invalid version -> error
- `GET /api/profiles/:id/diff/:vA/:vB` -> returns diff without allChanges
- `GET /api/profiles/:id/audit` -> returns paginated audit entries
- MCP `profile_list` -> returns profiles for tenant
- MCP `profile_get` with cross-tenant ID -> error

**Files**:
- `tests/profiles/routes.test.ts` (new, ~200 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/routes.ts` — 10+ route handlers, all tenant-scoped
- [ ] `src/profiles/tools.ts` — 7 MCP tool definitions
- [ ] `src/profiles/index.ts` — `initializeProfileModule` factory
- [ ] `src/index.ts` — profile routes mounted, tools registered
- [ ] All routes call `assertProfileAccessOrAudit` or filter by `tenantId`
- [ ] Feature vectors never returned in API responses (only metadata and diffs)
- [ ] Unit tests (11+ cases) covering routes and tools
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Tool registration pattern**: The MCP tool registration API may have changed since Spec 006. Inspect the current tool registration in `src/index.ts` or `src/tools/` to match the existing pattern.
- **Auth middleware dependency**: Routes depend on `req.tenantId` and `req.userId` being set by auth middleware. If the profile routes are mounted before the auth middleware, all requests will fail. Verify mount order in `src/index.ts`.
- **Feature vector exposure**: The version list and diff endpoints must NOT return raw feature vectors. They are sensitive (writing style fingerprint) and large (~2KB). Return metadata only.

## Reviewer Guidance

- Verify no route returns `featureVector` in the response body. Grep for `featureVector` in `routes.ts` — it should only appear in destructuring to EXCLUDE it from the response.
- Check that `POST /api/profiles/:id/retrain` returns 202 (Accepted), not 200 (OK). Retraining is async — the job is enqueued, not completed.
- Confirm `DELETE /api/profiles/:id` performs a soft delete (set status to 'archived'), not a hard delete (DELETE FROM). Profile data and versions must be retained for audit trail.
- Verify the `initializeProfileModule` function accepts an optional `engineClient` parameter and defaults to `NullProfileEngineClient`. This must log a warning at startup when using the null client.
