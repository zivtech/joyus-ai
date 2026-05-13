---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-13T13:02:35Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP07
---

# WP07 Review — Cycle 1

**Reviewer:** claude:opus:orchestrator:reviewer  
**Date:** 2026-05-13  
**Verdict:** CHANGES REQUESTED

---

## Summary

The safety service and usage service implementations are high quality — correct interfaces, proper hook chaining semantics, solid unit test coverage (18/18 passing), configurable idle detection, well-commented pricing constants. The service-level code satisfies FR-011 and FR-012 in isolation.

However, two blockers prevent approval: the services exist but are never called in the agent loop, and the per-session usage endpoint required by T051 is not implemented.

---

## Issue 1 — BLOCKER: Safety and usage services not wired into `processMessage`

**File:** `joyus-ai-mcp-server/src/orchestrator/agent-loop.service.ts`

`safetyService` and `usageService` are accepted as optional constructor deps and stored in private fields (lines 314–315, 323–324), but `processMessage` never calls them. There are zero calls to `runPreHooks`, `runPostHooks`, or `recordInvocation` anywhere in the agent loop body.

The T048/T049 spec explicitly requires:
- Before Claude invocation: `runPreHooks()`. If blocked, return block reason to user, skip the API call.
- After Claude response: `runPostHooks()`. If blocked, suppress response.
- After each `client.messages.create()` call: `recordInvocation()`.

**Required changes:**

1. In `processMessage`, before the agent loop's first invocation (after system prompt assembly), run pre-hooks:
   ```typescript
   if (this.safetyService) {
     const preResult = await this.safetyService.runPreHooks({
       tenantId,
       sessionId,
       systemPrompt,
       messages: loopMessages,
     });
     if (preResult.action === 'block') {
       throw new SafetyBlockedError('pre', preResult.reason);
     }
     if (preResult.action === 'modify') {
       systemPrompt = preResult.effectiveSystemPrompt;
     }
   }
   ```
   Note: The pre-hook should run once before the first invocation (on the assembled system prompt), not inside the tool-use loop.

2. Inside the agent loop, after each `agentClient.generate()` call completes with `end_turn` (final response), run post-hooks on the final text:
   ```typescript
   if (this.safetyService) {
     const postResult = await this.safetyService.runPostHooks({
       tenantId,
       sessionId,
       response: finalText,
       toolCalls: output.toolCalls,
     });
     if (postResult.action === 'block') {
       throw new SafetyBlockedError('post', postResult.reason);
     }
     if (postResult.action === 'modify') {
       finalText = postResult.effectiveResponse;
     }
   }
   ```

3. After each `agentClient.generate()` call (inside the tool-use loop and on the final call), emit usage:
   ```typescript
   if (this.usageService) {
     await this.usageService.recordInvocation({
       sessionId,
       tenantId,
       model: output.model,
       turnSequence: iterationCount,
       inputTokens: output.inputTokens,
       outputTokens: output.outputTokens,
       cacheHits: output.cacheHits,
       cacheCreations: output.cacheCreations,
       lastUserMessageAt: new Date(), // use actual user turn timestamp if available
     });
   }
   ```

4. The caller (wherever `AgentLoopService` is instantiated) should inject `createDefaultSafetyService()` and a `UsageService` instance. These are optional deps — no breaking change if not injected.

---

## Issue 2 — BLOCKER: T051 session GET endpoint missing `usage` field

**File:** `joyus-ai-mcp-server/src/orchestrator/routes/sessions.ts`

T051 explicitly requires: "Expose via session GET endpoint (add `usage` field to session response)."

The `GET /sessions/:sessionId` handler (line 82) returns the raw session record without a `usage` field. `UsageService.getSessionUsage()` is implemented but never called from any route. `createSessionsRouter` does not accept a `UsageService` dep.

**Required changes:**

1. Add optional `usageService` to the sessions router factory:
   ```typescript
   export function createSessionsRouter(
     sessionService: SessionService,
     memoryService?: MemoryService,
     usageService?: UsageService,
   ): Router
   ```

2. In the `GET /sessions/:sessionId` handler, fetch and attach usage when available:
   ```typescript
   const usage = usageService
     ? await usageService.getSessionUsage(tenantId, sessionId)
     : null;
   return res.json({ ...session, usage });
   ```

3. Wire `usageService` through from `OrchestratorRouterDeps` → `createOrchestratorRoutes` → `createSessionsRouter`.

---

## Issue 3 — MINOR: Redundant spread pattern in audit event emitters

**File:** `joyus-ai-mcp-server/src/orchestrator/safety.service.ts`, lines 304–305 and 337–338

Both `emitPreHookAuditEvent` and `emitPostHookAuditEvent` contain two mutually exclusive spread conditions that together unconditionally include `reason` when present. The two conditions cover all possible values of `outcome.action`, making one branch redundant:

```typescript
// Current (redundant):
...(outcome.action !== 'allow' && outcome.reason ? { reason: outcome.reason } : {}),
...(outcome.action === 'allow' && outcome.reason ? { reason: outcome.reason } : {}),

// Equivalent (clear):
...(outcome.reason ? { reason: outcome.reason } : {}),
```

The comment says "For 'allow' actions: emit event but with minimal payload (don't log the full prompt/response)" — this intent is not reflected in the code since reason IS included for allow actions when present. Decide: either include reason for all actions (simplify to one spread), or explicitly exclude reason for allow actions (remove the second condition). Either is fine; just resolve the inconsistency.

This is non-blocking but should be cleaned up.

---

## What Passed

- Safety interfaces (PreGenerationHook, PostGenerationHook) — clean, well-typed, correct outcome unions
- Hook chaining: first block stops the chain; modify propagates to subsequent hooks — correct
- Default pass-through: no hooks = all allowed — correct
- Audit events: emitted for every hook execution including allow actions — correct
- Audit failures are non-fatal — correct
- Usage tracking: token counts from API response correctly extracted — correct
- Per-session accumulation: Option A (event query) implemented, Option B noted as upgrade path — correct
- Idle detection: configurable threshold via constructor dep and env var — correct
- Idle detection emits signal-only event (no automatic action) — correct
- Cost constants clearly marked as approximate, not for billing — correct
- Agent loop accepts safety/usage as optional deps (no breaking change) — correct
- 18/18 unit tests passing: hook chaining, block/modify/allow, usage accumulation, idle detection, audit emission

---

## Fix Scope

Both blockers require changes to `agent-loop.service.ts` and `routes/sessions.ts`. The service implementations in `safety.service.ts` and `usage.service.ts` do not need changes. Estimated: ~50 lines of wiring code, no new tests required beyond verifying the wiring works (existing service-level tests are adequate).
