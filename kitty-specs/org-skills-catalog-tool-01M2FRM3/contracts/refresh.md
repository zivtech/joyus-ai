---
title: Refresh lifecycle and operator endpoint
status: specified
---

# Refresh contract

## State and freshness

There is one active generation per source and at most one candidate in flight per source per instance. Startup, timer and authenticated trigger invoke the same service method. Trigger bursts coalesce into the existing attempt. Global per-instance source concurrency is bounded by the source contract; queued work is not an unbounded task backlog.

| State / event | Read outcome | Activation outcome |
|---|---|---|
| No active generation | unavailable | only a fully validated candidate can activate |
| Valid generation, successful verification age < 5 minutes, no subsequent failure | fresh | same-revision successful verification updates verifiedAt |
| Verification age >= 5 minutes or a subsequent transient/validation failure | stale if age < 1 hour and policy permits | retain prior valid generation on rejection |
| Verification age >= 1 hour | unavailable | successful re-verification required |
| Source 401/403 | unavailable immediately on the observing instance | invalidate source authorization until successful re-verification |
| Policy disabled/missing/unapproved/unreadable, or changed epoch | unavailable regardless of cache age | old-epoch candidate cannot activate or authorize a read |
| Valid candidate at current epoch and current local attempt sequence | complete old or new generation | atomic swap; no partial publication |

`verifiedAt` is the time this instance completed successful source verification; failed refreshes never move it. Use an injectable monotonic elapsed clock for age/deadline decisions and UTC for reporting. Timer refresh starts every five minutes while configured; a delayed timer cannot extend freshness. Initial limits are maximums, not service availability promises. Invalid new content does not reset the prior generation's verification clock.

A candidate captures source/ref identity, current epoch and a monotonically increasing local attempt sequence. Before activating, reread authoritative policy and verify that entry, source/ref and epoch still match; then check the attempt sequence and atomically swap. Any policy lookup failure rejects activation. A read also checks policy live, so a late activation cannot authorize a read after policy disablement. Never compare commit hashes to decide which one is newer. Rollback uses a new epoch, and superseded candidates are discarded. Shutdown cancels timers, queued refreshes and source fetches; it does not persist body caches or entitlements.

Resolve the source credential once at candidate start and retain that credential snapshot only for the bounded attempt. Source credential rotation must also advance the policy epoch. If rotation occurs mid-download, the old attempt may finish fetching, but the activation fence discards it as superseded; a new attempt uses the new credential and epoch. If the old credential instead produces 401/403, reject that attempt and make its observing instance unavailable until successful verification with the current credential. Do not retry the same candidate under a replacement credential/epoch. Discard the credential reference at completion and never log it. Rotating only a refresh-trigger credential does not retroactively cancel an already authorized bounded attempt; use policy disablement to revoke its eligibility.

## Operator HTTP surface

`POST /internal/org-skills/refresh` uses a bearer refresh secret distinct from source-read credentials, user MCP tokens, and the cursor key. Bind each accepted secret to one configured tenant/source authorization; resolve the actual source from current policy. No source/tenant selector is accepted in path, query or body. An optional `ref` string (maximum 256 bytes) is informational only and must never select the fetched revision or be logged. An empty object/body is permitted. Reject other fields.

Authenticate before parsing the payload or reading any remote policy/source. Cap raw body at 1 KiB in a route-local parser placed before any global parser that would consume it. At most one new manual attempt per minute per source per instance (burst one); an authenticated duplicate while a job is running returns its existing operation ID without starting more work. Limit unauthenticated attempts by the existing rate-limit middleware with a safe fixed policy. Do not promise a cluster-wide quota from an in-process limiter.

| HTTP | Body | Meaning |
|---|---|---|
| 202 | `{status: "accepted", operationId}` | new bounded attempt scheduled |
| 202 | `{status: "in_progress", operationId}` | existing attempt coalesced |
| 400 | `{status: "rejected", category: "invalid_request"}` | malformed/unsupported input; no source request |
| 401 | `{status: "unavailable"}` | invalid refresh authentication; no remote read |
| 413 | `{status: "rejected", category: "request_too_large"}` | body limit exceeded |
| 429 | `{status: "rejected", category: "rate_limited"}` | rate/capacity limit; no new attempt |
| 503 | `{status: "unavailable"}` | missing current policy, credentials or usable service |

`GET /internal/org-skills/refresh/:operationId` uses the same scoped authentication. Return `in_progress`, `activated`, `rejected` or `unavailable` plus safe timestamps, duration and revision if known. Categories are enums: `validation`, `limit`, `timeout`, `upstream_rate_limit`, `upstream_failure`, `source_authorization`, `policy`, `superseded`, `shutdown`. Unknown, expired and differently scoped IDs return the same 404 unavailable result. No body, name menu, secret, raw input, source URL, provider error text or exception stack appears in status/logs.

Operation IDs are random and opaque, never credentials. Retain at most the latest 100 finished statuses per instance for ten minutes; evict oldest completed records only. An in-flight job remains within the 120-second bound. Routing to another instance or a restart can return unknown; this endpoint provides local attempt status, not durable job storage or a broadcast guarantee. Polling is optional because normal periodic refresh independently converges content.

The server's normal successful startup must not wait indefinitely for the optional catalog. Start its bounded load in the background; catalog reads are unavailable until ready. An operator policy disable is immediate for new reads across instances through the access contract; content revision convergence proceeds by periodic polling.
