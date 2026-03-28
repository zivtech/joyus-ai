---
work_package_id: WP09
title: Mediation API Endpoints
lane: done
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:54:10.792964+00:00'
subtasks: [T042, T043, T044, T045]
shell_pid: '59609'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP09: Mediation API Endpoints

## Objective

Implement the mediation REST API endpoints: session creation, message handling (with content retrieval and generation), session lifecycle, and health check.

## Implementation Command

```bash
spec-kitty implement WP09 --base WP08
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-020 through FR-023, SC-006)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/mediation-api.yaml` (authoritative endpoint definitions)
- **Dependencies**: WP06 (generation pipeline), WP08 (auth middleware, session management)

The mediation router is created in WP08. This WP adds the actual route handlers. The message endpoint is the critical path — it orchestrates the full retrieval → generation → citation pipeline via the GenerationService from WP06.

---

## Subtask T042: Implement POST /sessions

**Purpose**: Create a new mediation session with entitlement resolution.

**Steps**:
1. Add to `joyus-ai-mcp-server/src/content/mediation/router.ts`:
   ```typescript
   mediationRouter.post('/sessions', async (req, res) => {
     const { profileId } = CreateSessionInput.parse(req.body);
     const session = await sessionService.createSession(
       req.tenantId!, req.apiKey!.id, req.userId!, profileId
     );
     if (!session) return res.status(403).json({ error: 'No entitlements found for user' });
     res.status(201).json(formatSessionResponse(session));
   });
   ```
2. Response shape per mediation-api.yaml `MediationSession` schema:
   - id, integrationName, userId, activeProfileId, entitledProducts (array of {id, name}), messageCount, startedAt, lastActivityAt
3. Use Zod `CreateSessionInput` from WP01 validation schemas
4. Handle 401 (handled by middleware), 403 (no entitlements)

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/router.ts` (extend, ~40 lines)

**Validation**:
- [ ] Returns 201 with session details on success
- [ ] Returns 403 when user has no entitlements
- [ ] Response matches MediationSession schema
- [ ] Entitlements resolved during session creation

---

## Subtask T043: Implement POST /sessions/:id/messages

**Purpose**: Handle user messages — retrieve content, generate response, return with citations.

**Steps**:
1. Add to router:
   ```typescript
   mediationRouter.post('/sessions/:sessionId/messages', async (req, res) => {
     const { sessionId } = req.params;
     const { message, maxSources } = MediationMessageInput.parse(req.body);

     // 1. Get session, verify it belongs to this user/key
     const session = await sessionService.getSession(sessionId);
     if (!session || session.endedAt) return res.status(404).json({ error: 'Session not found or expired' });
     if (session.userId !== req.userId || session.apiKeyId !== req.apiKey!.id)
       return res.status(404).json({ error: 'Session not found' });

     // 2. Get session entitlements from cache
     const entitlements = await entitlementService.resolve(
       req.userId!, req.tenantId!, { sessionId, integrationId: req.apiKey!.id }
     );

     // 3. Generate response via GenerationService
     const result = await generationService.generate(
       message, req.userId!, req.tenantId!, entitlements,
       { profileId: session.activeProfileId, maxSources, sessionId }
     );

     // 4. Update session activity
     await sessionService.incrementMessageCount(sessionId);
     await sessionService.updateLastActivity(sessionId);

     // 5. Return MediationResponse
     res.json({
       message: result.text,
       citations: result.citations,
       profileUsed: result.profileUsed,
       metadata: {
         sourcesSearched: result.metadata.totalSearchResults,
         sourcesUsed: result.citations.length,
         responseTime: result.metadata.durationMs,
       }
     });
   });
   ```
2. Response shape per mediation-api.yaml `MediationResponse` schema
3. Validate input with Zod: message (required, max 10000 chars), maxSources (optional, default 5)

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/router.ts` (extend, ~60 lines)

**Validation**:
- [ ] Returns generated response with citations
- [ ] Session ownership verified (userId + apiKeyId match)
- [ ] Expired/closed sessions return 404
- [ ] Message count incremented
- [ ] Response matches MediationResponse schema
- [ ] Entitlement filtering applied (no unauthorized content)

---

## Subtask T044: Implement GET and DELETE /sessions/:id

**Purpose**: Retrieve session details and close sessions.

**Steps**:
1. Add GET handler:
   ```typescript
   mediationRouter.get('/sessions/:sessionId', async (req, res) => {
     const session = await sessionService.getSession(req.params.sessionId);
     if (!session || session.userId !== req.userId) return res.status(404).json({ error: 'Session not found' });
     res.json(formatSessionResponse(session));
   });
   ```
2. Add DELETE handler:
   ```typescript
   mediationRouter.delete('/sessions/:sessionId', async (req, res) => {
     const session = await sessionService.getSession(req.params.sessionId);
     if (!session || session.userId !== req.userId) return res.status(404).json({ error: 'Session not found' });
     await sessionService.closeSession(req.params.sessionId);
     // Clear cached entitlements for this session
     entitlementCache.invalidate(req.params.sessionId);
     res.status(204).send();
   });
   ```
3. Both verify session belongs to requesting user

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/router.ts` (extend, ~30 lines)

**Validation**:
- [ ] GET returns session details for valid sessions
- [ ] DELETE closes session and clears entitlement cache
- [ ] Both return 404 for non-existent or other users' sessions
- [ ] DELETE returns 204 (no body)

---

## Subtask T045: Implement GET /health

**Purpose**: Health check for the mediation subsystem (no auth required).

**Steps**:
1. Add to router (before auth middleware, or use the health exclusion pattern from WP08):
   ```typescript
   mediationRouter.get('/health', async (_req, res) => {
     const health = {
       status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
       components: {
         database: await checkDbHealth(),
         entitlementResolver: await checkResolverHealth(),
         searchProvider: await checkSearchHealth(),
       },
       timestamp: new Date().toISOString(),
     };

     // Determine overall status
     const componentStatuses = Object.values(health.components);
     if (componentStatuses.some(s => s === 'unhealthy')) health.status = 'unhealthy';
     else if (componentStatuses.some(s => s === 'degraded')) health.status = 'degraded';

     const httpStatus = health.status === 'unhealthy' ? 503 : 200;
     res.status(httpStatus).json(health);
   });
   ```
2. Response per mediation-api.yaml `HealthStatus` schema
3. Component checks: database ping, entitlement resolver reachability (if configured), search provider query

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/router.ts` (extend, ~40 lines)

**Validation**:
- [ ] No authentication required
- [ ] Returns 200 when healthy, 503 when unhealthy
- [ ] Per-component status reported
- [ ] Response matches HealthStatus schema

---

## Definition of Done

- [ ] POST /sessions creates session with entitlement resolution
- [ ] POST /sessions/:id/messages generates content-aware response with citations
- [ ] GET /sessions/:id returns session details
- [ ] DELETE /sessions/:id closes session and clears cache
- [ ] GET /health reports subsystem health without auth
- [ ] All responses match mediation-api.yaml schemas
- [ ] `npm run typecheck` passes

## Risks

- **Message endpoint latency**: Must orchestrate retrieval + generation in a single request. Monitor total response time.
- **Concurrent sessions**: SC-006 requires 100 concurrent sessions. Ensure no shared mutable state between sessions.

## Reviewer Guidance

- Verify session ownership checks on all endpoints (prevent cross-user session access)
- Check that message endpoint uses GenerationService (not raw search + generation)
- Confirm health endpoint is excluded from auth middleware
- Verify response shapes match mediation-api.yaml exactly

## Activity Log

- 2026-02-21T12:59:56Z – unknown – shell_pid=59609 – lane=done – Mediation endpoints — sessions, messages
